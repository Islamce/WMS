/**
 * Application startup file for managed Node.js hosting (Hostinger hPanel /
 * Phusion Passenger, cPanel "Setup Node.js App", etc.).
 *
 * Those panels ask for a single "Application startup file" at the project
 * root and start it themselves — they set PORT (or a socket) in the
 * environment, which server/index.js already honours. This thin shim just
 * boots the real server so the panel has a root entry point to point at.
 */
require('./server/index.js');
