// Vite can inherit NODE_ENV=development from a local .env. Release assets must
// use React's production runtime, independently of the backend's local mode.
process.env.NODE_ENV='production';
const {build}=await import('vite');
await build({mode:process.argv.includes('--demo')?'demo':'production'});
