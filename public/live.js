(function () {
  var token = new URLSearchParams(window.location.search).get('token') || '';

  function esc(s) {
    return String(s || '').split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
  }

  function completeTodo(content, rowEl) {
    rowEl.style.transition = 'opacity 0.3s, transform 0.3s';
    rowEl.style.opacity = '0';
    rowEl.style.transform = 'translateX(-100%)';
    setTimeout(function () {
      rowEl.remove();
      var container = document.getElementById('sidebar-todos');
      var countEl = document.getElementById('todos-count');
      if (container && !container.querySelector('.row')) {
        container.innerHTML = '<p class="nil">nothing open — all clear</p>';
      }
      if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent || '0') - 1);
    }, 300);

    fetch('/dashboard/api/complete-todo?token=' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    }).catch(function () {});
  }

  function addSwipeHandlers(rowEl, content) {
    var startX = 0, startY = 0, isDragging = false;

    rowEl.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = false;
    }, { passive: true });

    rowEl.addEventListener('touchmove', function (e) {
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      if (!isDragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) isDragging = true;
      if (!isDragging) return;
      if (dx < 0) rowEl.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });

    rowEl.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - startX;
      if (isDragging && dx < -80) {
        completeTodo(content, rowEl);
      } else {
        rowEl.style.transform = '';
      }
    });

    // Desktop: double-click to complete
    rowEl.addEventListener('dblclick', function () {
      completeTodo(content, rowEl);
    });
  }

  function renderGroup(todos, label, color) {
    return todos.map(function (t, i) {
      return {
        content: t.content,
        html: '<span class="row-num">' + (i + 1) + '</span>' +
              '<span class="row-tag" style="color:' + color + '">' + label.toLowerCase() + '</span>' +
              '<span class="row-body">' + esc(t.content) + '</span>' +
              '<span class="todo-done-hint">swipe ← or double-click to complete</span>'
      };
    });
  }

  function applyTodos(data) {
    var container = document.getElementById('sidebar-todos');
    var countEl   = document.getElementById('todos-count');
    if (!container) return;

    var total = data.hexaware.length + data.smartresq.length + data.personal.length;
    if (countEl) countEl.textContent = total;

    if (!total) {
      container.innerHTML = '<p class="nil">nothing open — all clear</p>';
      return;
    }

    var groups = [].concat(
      renderGroup(data.hexaware, 'Hexaware', '#4f8ef7'),
      renderGroup(data.smartresq, 'SmartResQ', '#34d399'),
      renderGroup(data.personal, 'Personal', '#a78bfa')
    );

    container.innerHTML = '';
    groups.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = 'touch-action: pan-y; cursor: default; user-select: none;';
      row.innerHTML = item.html;
      addSwipeHandlers(row, item.content);
      container.appendChild(row);
    });
  }

  window.refreshTodos = function () {
    fetch('/dashboard/api/todos?token=' + token)
      .then(function (r) { return r.json(); })
      .then(applyTodos)
      .catch(function () {});
  };

  // Inject hint CSS
  var style = document.createElement('style');
  style.textContent = '.todo-done-hint{display:none;font-size:10px;color:var(--t3);margin-left:auto;padding-left:8px;flex-shrink:0}' +
                      '.row:hover .todo-done-hint{display:block}';
  document.head.appendChild(style);

  setInterval(window.refreshTodos, 60000);

  var es = new EventSource('/dashboard/stream?token=' + token);
  es.addEventListener('refresh', function () { window.refreshTodos(); });
  es.onerror = function () { es.close(); setTimeout(function () { window.location.reload(); }, 30000); };
})();
