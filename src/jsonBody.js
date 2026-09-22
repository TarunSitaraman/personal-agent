// The app-wide JSON body parser, minus the upload routes. Those declare their own larger parsers
// (express.json({ limit })), which never ran while a global express.json() with the default 100 KB
// limit sat in front of them: every voice note and image upload got 413 Payload Too Large.
const express = require('express');

const UPLOADS = new Set(['/dashboard/chat/voice', '/dashboard/chat/image']);

const isUpload = path => UPLOADS.has(path);

function jsonExceptUploads() {
  const json = express.json();
  return (req, res, next) => (isUpload(req.path) ? next() : json(req, res, next));
}

module.exports = { jsonExceptUploads, isUpload };
