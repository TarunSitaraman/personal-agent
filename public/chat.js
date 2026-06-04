(function () {
  var token  = new URLSearchParams(window.location.search).get('token') || '';
  var msgs   = document.getElementById('chat-msgs');
  var input  = document.getElementById('chat-input');
  var typing = document.getElementById('chat-typing');
  var busy   = false;

  function esc(s) {
    return String(s || '').split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('\n').join('<br>');
  }

  function appendMsg(role, text, imgSrc) {
    if (typing) typing.classList.remove('visible');
    var d = document.createElement('div');
    d.className = 'chat-msg ' + (role === 'user' ? 'user' : 'blu');
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = esc(text);
    if (imgSrc) {
      var img = document.createElement('img');
      img.className = 'chat-img-preview';
      img.src = imgSrc;
      d.appendChild(img);
    }
    d.appendChild(bubble);
    if (typing) msgs.insertBefore(d, typing);
    else msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return bubble;
  }

  window.bluSend = async function () {
    var text = (input.value || '').trim();
    if (!text || busy) return;

    appendMsg('user', text);
    input.value = '';
    input.style.height = '';
    if (typing) typing.classList.add('visible');
    msgs.scrollTop = msgs.scrollHeight;
    busy = true;
    window._bluChatBusy = true;

    // Create reply bubble for streaming
    if (typing) typing.classList.remove('visible');
    var replyRow = document.createElement('div');
    replyRow.className = 'chat-msg blu';
    var replyBubble = document.createElement('div');
    replyBubble.className = 'chat-bubble';
    replyBubble.innerHTML = '<span style="opacity:.4">●●●</span>';
    replyRow.appendChild(replyBubble);
    if (typing) msgs.insertBefore(replyRow, typing);
    else msgs.appendChild(replyRow);
    msgs.scrollTop = msgs.scrollHeight;

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 90000);
    var gotContent = false;

    try {
      var r = await fetch('/dashboard/chat/stream?token=' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: ctrl.signal
      });

      clearTimeout(timer);

      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      var replyText = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buf += decoder.decode(result.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data:')) continue;
          try {
            var evt = JSON.parse(line.slice(5));
            if (evt.t !== undefined) {
              if (!gotContent) { replyBubble.innerHTML = ''; gotContent = true; }
              replyText += evt.t;
              replyBubble.innerHTML = esc(replyText);
              msgs.scrollTop = msgs.scrollHeight;
            } else if (evt.reply !== undefined) {
              // Final reply — use it if streaming missed chars
              var final = evt.reply || replyText;
              replyBubble.innerHTML = esc(final);
              msgs.scrollTop = msgs.scrollHeight;
              if (window.refreshTodos) window.refreshTodos();
            } else if (evt.message) {
              replyBubble.innerHTML = 'Error: ' + esc(evt.message);
            }
          } catch {}
        }
      }
    } catch (e) {
      clearTimeout(timer);
      replyBubble.innerHTML = e.name === 'AbortError' ? 'Timed out — try again.' : 'Error: ' + esc(e.message);
    } finally {
      busy = false;
      window._bluChatBusy = false;
    }
  };

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.bluSend(); }
  });
  input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  var imgBtn   = document.getElementById('chat-img-btn');
  var imgInput = document.getElementById('chat-img-input');
  if (imgBtn) imgBtn.onclick = function () { imgInput.click(); };
  if (imgInput) imgInput.addEventListener('change', async function () {
    var file = this.files[0];
    if (!file) return;
    this.value = '';
    var reader = new FileReader();
    reader.onload = async function (ev) {
      var dataUrl = ev.target.result;
      var caption = (input.value || '').trim();
      appendMsg('user', caption || 'Image', dataUrl);
      input.value = '';
      input.style.height = '';
      if (typing) typing.classList.add('visible');
      busy = true;
      try {
        var r = await fetch('/dashboard/chat/image?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: dataUrl.split(',')[1], mimeType: file.type, caption: caption })
        });
        var d = await r.json();
        appendMsg('blu', d.reply || d.error || '(no response)');
        if (window.refreshTodos) window.refreshTodos();
      } catch (e) {
        appendMsg('blu', 'Image error: ' + e.message);
      } finally {
        busy = false;
      }
    };
    reader.readAsDataURL(file);
  });

  var SR     = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recog  = SR ? new SR() : null;
  var listen = false;
  var vBtn   = document.getElementById('chat-voice-btn');
  if (recog) {
    recog.lang = 'en-IN';
    recog.interimResults = false;
    recog.onresult = function (e) {
      input.value = e.results[0][0].transcript;
      input.dispatchEvent(new Event('input'));
      listen = false;
      if (vBtn) vBtn.classList.remove('recording');
    };
    recog.onend = function () {
      listen = false;
      if (vBtn) vBtn.classList.remove('recording');
    };
  }
  if (vBtn) vBtn.onclick = function () {
    if (!recog) { alert('Voice not supported in this browser.'); return; }
    if (listen) { recog.stop(); } else { recog.start(); listen = true; vBtn.classList.add('recording'); }
  };

  try {
    var raw = msgs.dataset.history;
    if (raw) {
      var hist = JSON.parse(atob(raw));
      if (Array.isArray(hist)) {
        hist.forEach(function (m) { if (m && m.content) appendMsg(m.role, m.content); });
        msgs.scrollTop = msgs.scrollHeight;
      }
    }
  } catch (e) {}
})();
