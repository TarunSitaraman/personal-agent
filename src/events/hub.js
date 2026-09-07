const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function notify() {
  for (const res of clients) {
    res.write('event: refresh\ndata: {}\n\n');
  }
}

module.exports = { addClient, removeClient, notify };
