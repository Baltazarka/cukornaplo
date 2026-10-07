// Napi grafikonok: glükóz, inzulin, szénhidrát — közös 0–24 órás időtengellyel.
(function () {
  'use strict';
  var D = window.DAY;
  if (!D || !window.Chart) return;

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  var C = {
    surface: token('--surface-1'),
    text: token('--text-secondary'),
    muted: token('--text-muted'),
    grid: token('--grid'),
    axis: token('--axis'),
    glucose: token('--series-glucose'),
    insulin: token('--series-insulin'),
    basal: token('--series-basal'),
    carbs: token('--series-carbs'),
    band: token('--band'),
    low: token('--status-critical'),
  };

  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = C.muted;

  var HOUR = 3600000;
  function hhmm(ms) {
    return new Date(ms).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  }
  function num(v, dec) {
    return v.toLocaleString('hu-HU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function xScale(showTicks) {
    return {
      type: 'linear',
      min: D.dayStart,
      max: D.dayEnd,
      offset: false, // oszlopdiagramnál is a rácsvonalon legyen az időcímke
      grid: { color: C.grid, drawTicks: false, offset: false },
      border: { color: C.axis },
      ticks: {
        display: showTicks,
        stepSize: 3 * HOUR,
        padding: 6,
        maxRotation: 0,
        callback: function (v) { return hhmm(v); },
      },
      afterBuildTicks: function (axis) {
        var step = (axis.chart.width < 520 ? 6 : 3) * HOUR;
        var t = [];
        for (var v = D.dayStart; v <= D.dayEnd; v += step) t.push({ value: v });
        axis.ticks = t;
      },
    };
  }

  // Mindhárom grafikon bal oldali tengelye egyforma széles legyen, hogy az idők egymás alá essenek.
  function fixedYWidth(axis) { axis.width = 44; }

  var tooltip = {
    backgroundColor: token('--tooltip-bg'),
    titleColor: token('--text-primary'),
    bodyColor: token('--text-secondary'),
    borderColor: token('--border'),
    borderWidth: 1,
    padding: 10,
    displayColors: true,
    boxWidth: 8,
    boxHeight: 8,
    usePointStyle: true,
    callbacks: { title: function (items) { return items.length ? hhmm(items[0].parsed.x) : ''; } },
  };

  // Céltartomány sáv a glükózgörbe mögött.
  var bandPlugin = {
    id: 'targetBand',
    beforeDatasetsDraw: function (chart) {
      var a = chart.chartArea, y = chart.scales.y, ctx = chart.ctx;
      var top = y.getPixelForValue(D.range.high), bottom = y.getPixelForValue(D.range.low);
      ctx.save();
      ctx.fillStyle = C.band;
      ctx.fillRect(a.left, top, a.right - a.left, bottom - top);
      ctx.restore();
    },
  };

  // Érték felirat az oszlopok fölött (egy nap alatt kevés esemény van, így olvasható marad).
  var barLabels = {
    id: 'barLabels',
    afterDatasetsDraw: function (chart, args, opts) {
      var ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = C.text;
      ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      chart.data.datasets.forEach(function (ds, i) {
        chart.getDatasetMeta(i).data.forEach(function (bar, j) {
          ctx.fillText(num(ds.data[j].y, opts.decimals), bar.x, bar.y - 3);
        });
      });
      ctx.restore();
    },
  };

  // Glükóz: 15 percnél hosszabb szünetnél megszakad a vonal.
  var gPoints = [];
  D.glucose.forEach(function (p, i) {
    if (i > 0 && p[0] - D.glucose[i - 1][0] > 15 * 60000) gPoints.push({ x: p[0] - 1, y: null });
    gPoints.push({ x: p[0], y: p[1] });
  });
  var gMax = D.glucose.reduce(function (m, p) { return Math.max(m, p[1]); }, 0);

  new Chart(document.getElementById('chart-glucose'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Glükóz',
        data: gPoints,
        borderColor: C.glucose,
        backgroundColor: C.glucose,
        borderWidth: 2,
        // Folyamatos szenzorgörbénél nincs pont, a magányos (pl. bólus kalkulátoros) mérések viszont pontként látszanak.
        pointRadius: function (ctx) {
          var d = ctx.dataset.data, i = ctx.dataIndex;
          var prev = d[i - 1], next = d[i + 1];
          var isolated = (!prev || prev.y === null) && (!next || next.y === null);
          return isolated && d[i].y !== null ? 4 : 0;
        },
        pointBackgroundColor: function (ctx) {
          var v = ctx.raw && ctx.raw.y;
          return v !== null && v < D.range.low ? C.low : C.glucose;
        },
        pointBorderColor: C.surface,
        pointBorderWidth: 1.5,
        pointHoverRadius: 5,
        pointHoverBorderColor: C.surface,
        pointHoverBorderWidth: 2,
        spanGaps: false,
        tension: 0.2,
        segment: {
          borderColor: function (ctx) {
            return (ctx.p0.parsed.y < D.range.low || ctx.p1.parsed.y < D.range.low) ? C.low : undefined;
          },
        },
      }],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: Object.assign({}, tooltip, {
          displayColors: false,
          callbacks: Object.assign({}, tooltip.callbacks, {
            label: function (i) { return num(i.parsed.y, 1) + ' mmol/L'; },
          }),
        }),
      },
      scales: {
        x: xScale(true),
        y: {
          min: 2,
          max: Math.max(16, Math.ceil(gMax + 1)),
          afterFit: fixedYWidth,
          grid: { color: C.grid, drawTicks: false },
          border: { display: false },
          ticks: { padding: 6, stepSize: 2 },
        },
      },
    },
    plugins: [bandPlugin],
  });

  function barChart(id, datasets, unit, decimals) {
    var maxV = 0;
    datasets.forEach(function (ds) { ds.data.forEach(function (p) { maxV = Math.max(maxV, p.y); }); });
    return new Chart(document.getElementById(id), {
      type: 'bar',
      data: { datasets: datasets },
      options: {
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 16 } },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          barLabels: { decimals: decimals },
          tooltip: Object.assign({}, tooltip, {
            callbacks: Object.assign({}, tooltip.callbacks, {
              label: function (i) { return ' ' + i.dataset.label + ': ' + num(i.parsed.y, decimals) + ' ' + unit; },
            }),
          }),
        },
        scales: {
          x: xScale(true),
          y: {
            min: 0,
            suggestedMax: Math.max(1, maxV * 1.15),
            afterFit: fixedYWidth,
            grid: { color: C.grid, drawTicks: false },
            border: { display: false },
            ticks: { padding: 6, maxTicksLimit: 3 },
          },
        },
      },
      plugins: [barLabels],
    });
  }

  function barSet(label, data, color) {
    return {
      label: label,
      data: data,
      backgroundColor: color,
      borderRadius: { topLeft: 4, topRight: 4 },
      borderSkipped: 'bottom',
      barThickness: 8,
      minBarLength: 2,
    };
  }

  var bolus = D.insulin.filter(function (p) { return p[2] !== 'basal'; }).map(function (p) { return { x: p[0], y: p[1] }; });
  var basal = D.insulin.filter(function (p) { return p[2] === 'basal'; }).map(function (p) { return { x: p[0], y: p[1] }; });
  var insulinSets = [barSet(basal.length ? 'Bólus' : 'Inzulin', bolus, C.insulin)];
  if (basal.length) {
    insulinSets.push(barSet('Bázis', basal, C.basal));
    document.getElementById('insulin-legend').innerHTML =
      '<span class="key" style="background:var(--series-insulin)"></span> bólus · ' +
      '<span class="key" style="background:var(--series-basal)"></span> bázis';
  }
  barChart('chart-insulin', insulinSets, 'E', 1);
  barChart('chart-carbs', [barSet('Szénhidrát', D.carbs.map(function (p) { return { x: p[0], y: p[1] }; }), C.carbs)], 'g', 0);
})();
