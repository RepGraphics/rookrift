export const PLANS = Object.freeze({
  scout: { id: 'scout', name: 'Scout', price: 0, servers: 2, schedules: 2, workflows:2, templates: 3, windows: 0, historyDays: 2, staff: 0 },
  tribe: { id: 'tribe', name: 'Tribe', price: 3.99, servers: 5, schedules: 10, workflows:10, templates: 25, windows: 10, historyDays: 7, staff: 3 },
  cluster: { id: 'cluster', name: 'Cluster', price: 9.99, servers: 20, schedules: 50, workflows:50, templates: 100, windows: 50, historyDays: 30, staff: 10 }
});
export function effectivePlan(workspace) {
  return ['active', 'trialing'].includes(workspace.subscription_status) ? (PLANS[workspace.plan] || PLANS.scout) : PLANS.scout;
}
export function assertCapacity(workspace, count, kind = 'servers') {
  const plan = effectivePlan(workspace);
  if (count >= plan[kind]) throw Object.assign(new Error(`${plan.name} allows ${plan[kind]} ${kind}. Upgrade your plan to add more.`), { status: 403 });
}
export function assertServerEntitled(workspace, servers, id) {
  const allowed = servers.slice(0, effectivePlan(workspace).servers).some(server => server.id === id);
  if (!allowed) throw Object.assign(new Error('This server is paused by your current plan. Upgrade or remove an older server.'), { status: 403 });
}
