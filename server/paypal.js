const apiBase = env => (env.PAYPAL_ENVIRONMENT === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

export function createPayPal(env = process.env) {
  const ready = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID);
  let token;
  let tokenExpires = 0;
  const request = async (path, options = {}) => {
    if (!ready) throw Object.assign(new Error('PayPal is not configured.'), { status: 503 });
    const response = await fetch(apiBase(env) + path, {...options,signal:AbortSignal.timeout(10000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || data.name || 'PayPal request failed.'), { status: response.status >= 500 ? 502 : 400 });
    return data;
  };
  const accessToken = async () => {
    if (token && tokenExpires > Date.now() + 30000) return token;
    const encoded = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await fetch(apiBase(env) + '/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw Object.assign(new Error('PayPal authentication failed.'), { status: 503 });
    token = data.access_token;
    tokenExpires = Date.now() + Number(data.expires_in || 300) * 1000;
    return token;
  };
  const api = async (path, options = {}) => {
    const access = await accessToken();
    return request(path, { ...options, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  };
  return {
    ready,
    async getSubscription(id){return api('/v1/billing/subscriptions/'+encodeURIComponent(id));},
    async createOrder({ reference, amount, currency, returnUrl, cancelUrl }) {
      const order = await api('/v2/checkout/orders', { method: 'POST', headers: { 'PayPal-Request-Id': reference }, body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: reference, custom_id: reference, amount: { currency_code: currency.toUpperCase(), value: (amount / 100).toFixed(2) } }],
        application_context: { user_action: 'PAY_NOW', return_url: returnUrl, cancel_url: cancelUrl }
      }) });
      return { id: order.id, url: order.links?.find(link => link.rel === 'approve')?.href };
    },
    async captureOrder(id) {
      return api(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { method: 'POST', headers: { 'PayPal-Request-Id': id } });
    },
    async createSubscription({ planId, reference, returnUrl, cancelUrl }) {
      const subscription = await api('/v1/billing/subscriptions', { method: 'POST', headers: { 'PayPal-Request-Id': reference }, body: JSON.stringify({
        plan_id: planId,
        custom_id: reference,
        application_context: { user_action: 'SUBSCRIBE_NOW', return_url: returnUrl, cancel_url: cancelUrl }
      }) });
      return { id: subscription.id, url: subscription.links?.find(link => link.rel === 'approve')?.href };
    },
    async verifyWebhook(headers, body) {
      return api('/v1/notifications/verify-webhook-signature', { method: 'POST', body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: body
      }) }).then(result => result.verification_status === 'SUCCESS');
    }
  };
}
