const { initializeConfig } = require('./platform/config');
const config = initializeConfig();
const { createApp } = require('./app');
const app = createApp(config);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(Number(process.env.PORT ?? 8787), host, () => {
  console.log(`DuduLove Memory: http://${host}:${server.address().port}`);
});
const { tickOrganization } = require('./memory-core/organizationTasks');
const memoryDB = require('./storage/database'), chatsDB = require('./storage/chats');
const timer = setInterval(() => tickOrganization(memoryDB, chatsDB).catch(() => console.warn('Periodic organization failed; originals preserved')), 60000);
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); server.close(() => process.exit(0)); });
