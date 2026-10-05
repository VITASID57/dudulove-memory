'use strict';
// Store text independently of any frontend's editor or markup renderer.
function normalizeMemoryContent(content) {
  return String(content ?? '').replace(/\r\n?/g, '\n').trim();
}
module.exports = { normalizeMemoryContent };
