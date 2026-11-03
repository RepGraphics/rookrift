export const PLANS = Object.freeze({
  scout: { id: 'scout', name: 'Scout', price: 0, servers: 1, schedules: 0, historyDays: 1 },
  tribe: { id: 'tribe', name: 'Tribe', price: 9, servers: 5, schedules: 10, historyDays: 7 },
  cluster: { id: 'cluster', name: 'Cluster', price: 24, servers: 20, schedules: 50, historyDays: 30 }
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
