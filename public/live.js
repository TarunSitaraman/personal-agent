(function () {
  var token = new URLSearchParams(window.location.search).get('token') || '';

  function esc(s) {
    return String(s || '').split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
  }

  function renderGroup(todos, label, color) {
    return todos.map(function (t, i) {
      return '<div class="row">' +
        '<span class="row-num">' + (i + 1) + '</span>' +
        '<span class="row-tag" style="color:' + color + '">' + label.toLowerCase() + '</span>' +
        '<span class="row-body">' + esc(t.content) + '</span>' +
        '</div>';
    }).join('');
  }

  function applyTodos(data) {
    var container = document.getElementById('sidebar-todos');
    var countEl   = document.getElementById('todos-count');
    if (!container) return;

    var total = data.hexaware.length + data.smartresq.length + data.personal.length;
    if (countEl) countEl.textContent = total;

    var html = renderGroup(data.hexaware, 'Hexaware', '#4f8ef7') +
               renderGroup(data.smartresq, 'SmartResQ', '#34d399') +
               renderGroup(data.personal, 'Personal', '#a78bfa');

    container.innerHTML = html || '<p class="nil">nothing open — all clear</p>';
  }

  window.refreshTodos = function () {
    fetch('/dashboard/api/todos?token=' + token)
      .then(function (r) { return r.json(); })
      .then(applyTodos)
      .catch(function () {});
  };

  // Poll every 60 seconds
  setInterval(window.refreshTodos, 60000);

  // SSE — refresh todos on incoming event, full reload only on error
  var es = new EventSource('/dashboard/stream?token=' + token);
  es.addEventListener('refresh', function () {
    window.refreshTodos();
  });
  es.onerror = function () {
    es.close();
    setTimeout(function () { window.location.reload(); }, 30000);
  };
})();
