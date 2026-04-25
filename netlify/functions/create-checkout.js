/**
 * IHAP Donation Portal — Netlify Function: create-checkout.js
 *
 * Creates a Stripe Checkout session for one-time or recurring donations.
 * Returns a Stripe-hosted checkout URL the portal redirects the donor to.
 *
 * Required environment variables (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY          = sk_live_... (Stripe secret key for IHAP account)
 *   STRIPE_WEBHOOK_SECRET      = whsec_...   (from Stripe webhook dashboard)
 *   NOTIFICATION_EMAIL         = chad@healthcred.com
 *
 * Optional (for Gmail receipt backup):
 *   GMAIL_USER                 = chad@healthcred.com
 *   GMAIL_APP_PASSWORD         = (16-char Google App Password)
 */

const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function stripePost(path, params, secretKey) {
  const body = Object.entries(params)
    .flatMap(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        return Object.entries(v).map(([k2, v2]) => `${encodeURIComponent(k+'['+k2+']')}=${encodeURIComponent(v2)}`);
      }
      return [`${encodeURIComponent(k)}=${encodeURIComponent(v)}`];
    })
    .join('&');
  return httpsPost('api.stripe.com', path, {
    'Authorization': `Bearer ${secretKey}`,
    'Content-Type':  'application/x-www-form-urlencoded'
  }, body);
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const {
      amount, currency = 'usd', frequency = 'one_time',
      email, firstName, lastName, orgName,
      contactName, contactTitle, companyEin,
      successUrl, cancelUrl
    } = JSON.parse(event.body || '{}');

    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_KEY) {
      return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in Netlify environment variables.' }) };
    }

    const donorName = orgName || [firstName, lastName].filter(Boolean).join(' ') || 'Donor';
    const amtDollars = (amount / 100).toFixed(2);

    // Build metadata
    const metadata = {
      donor_name:    donorName,
      donor_email:   email || '',
      org_name:      orgName || '',
      contact_name:  contactName || '',
      contact_title: contactTitle || '',
      company_ein:   companyEin || '',
      frequency,
      amount_cents:  String(amount),
      ihap_ein:      '41-4339110'
    };

    let sessionParams;

    if (frequency === 'monthly') {
      // ── RECURRING: create price on the fly then subscription checkout ──
      const priceRes = await stripePost('/v1/prices', {
        unit_amount:   amount,
        currency,
        recurring:     { interval: 'month' },
        product_data:  { name: 'IHAP Monthly Gift — Inmate Health Access Program' }
      }, STRIPE_KEY);

      if (priceRes.status !== 200) throw new Error('Price creation failed: ' + JSON.stringify(priceRes.body));
      const priceId = priceRes.body.id;

      sessionParams = {
        mode: 'subscription',
        'line_items[0][price]':    priceId,
        'line_items[0][quantity]': 1,
        'customer_email':          email || '',
        'success_url':             successUrl,
        'cancel_url':              cancelUrl,
        'metadata[donor_name]':    donorName,
        'metadata[frequency]':     'monthly',
        'metadata[ihap_ein]':      '41-4339110',
        'metadata[org_name]':      orgName || '',
        'subscription_data[metadata][donor_name]':  donorName,
        'subscription_data[metadata][ihap_ein]':    '41-4339110',
        'subscription_data[metadata][frequency]':   'monthly',
      };
    } else {
      // ── ONE-TIME payment ──
      sessionParams = {
        mode: 'payment',
        'line_items[0][price_data][currency]':                    currency,
        'line_items[0][price_data][unit_amount]':                 amount,
        'line_items[0][price_data][product_data][name]':          'IHAP Charitable Gift — Inmate Health Access Program',
        'line_items[0][price_data][product_data][description]':   `Tax-deductible donation. EIN 41-4339110. No goods or services provided.`,
        'line_items[0][quantity]':                                1,
        'customer_email':                                         email || '',
        'success_url':                                            successUrl,
        'cancel_url':                                             cancelUrl,
        'metadata[donor_name]':    donorName,
        'metadata[frequency]':     'one_time',
        'metadata[ihap_ein]':      '41-4339110',
        'metadata[org_name]':      orgName || '',
        'metadata[amount_cents]':  String(amount),
        'payment_intent_data[description]': `IHAP Charitable Donation — ${donorName}`,
        'payment_intent_data[metadata][donor_name]':  donorName,
        'payment_intent_data[metadata][ihap_ein]':    '41-4339110',
        'payment_intent_data[metadata][frequency]':   'one_time',
      };
    }

    const sessionRes = await stripePost('/v1/checkout/sessions', sessionParams, STRIPE_KEY);

    if (sessionRes.status !== 200) throw new Error('Session creation failed: ' + JSON.stringify(sessionRes.body));

    console.log(`Checkout session created: ${sessionRes.body.id} | ${donorName} | $${amtDollars} | ${frequency}`);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sessionRes.body.url, sessionId: sessionRes.body.id })
    };

  } catch (err) {
    console.error('create-checkout error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
