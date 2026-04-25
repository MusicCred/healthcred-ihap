/**
 * IHAP Donation Portal — Netlify Function: stripe-webhook.js
 *
 * Handles Stripe webhook events:
 *   - checkout.session.completed  → sends tax receipt email to donor + notification to Chad
 *   - invoice.payment_succeeded   → monthly renewal receipts
 *   - loi_inquiry (internal)      → forwards foundation grant inquiry to Chad
 *
 * Required environment variables:
 *   STRIPE_WEBHOOK_SECRET   = whsec_...
 *   GMAIL_USER              = chad@healthcred.com
 *   GMAIL_APP_PASSWORD      = (16-char Google App Password)
 *   NOTIFICATION_EMAIL      = chad@healthcred.com
 */

const crypto   = require('crypto');
const https    = require('https');
const nodemailer = require('nodemailer');

function verifyStripeSignature(payload, signature, secret) {
  const parts   = signature.split(',').reduce((acc, p) => { const [k,v] = p.split('='); acc[k] = v; return acc; }, {});
  const ts      = parts.t;
  const sig     = parts.v1;
  const signed  = `${ts}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return expected === sig;
}

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

function formatCurrency(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

async function sendDonorReceipt({ to, donorName, amountCents, frequency, date, orgName, contactName }) {
  const transporter = getTransporter();
  const amtFmt  = formatCurrency(amountCents);
  const freqStr = frequency === 'monthly' ? 'Monthly Recurring Gift' : 'One-Time Gift';
  const displayName = orgName || donorName || 'Valued Donor';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f7f2;font-family:Georgia,serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f2;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">

  <!-- Header -->
  <tr><td style="background:#2D1A47;padding:32px 40px;text-align:center">
    <div style="font-family:sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#5C3D96;margin-bottom:8px">IHAP · Inmate Health Access Program</div>
    <div style="font-size:24px;color:#ffffff;font-style:italic">Thank You for Your Gift</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:40px 40px 32px">
    <p style="color:#1c1c1c;font-size:16px;line-height:1.7;margin-bottom:20px">Dear ${displayName},</p>
    <p style="color:#5a5a5a;font-size:15px;line-height:1.75;margin-bottom:24px">
      We are deeply grateful for your charitable contribution to the Inmate Health Access Program. Your support directly funds health coverage access, reentry care coordination, and housing stabilization for justice-involved individuals across Florida, Georgia, and Alabama.
    </p>

    <!-- Receipt box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;border:1px solid #e8e8e8;border-radius:8px;margin-bottom:28px">
      <tr><td style="padding:24px 28px">
        <div style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#5C3D96;margin-bottom:16px">Official Gift Acknowledgment</div>
        <table width="100%" cellpadding="4" cellspacing="0" style="font-family:sans-serif;font-size:14px">
          <tr><td style="color:#5a5a5a;width:180px">Organization</td><td style="color:#2D1A47;font-weight:700">IHAP Inmate Health Access Program</td></tr>
          <tr><td style="color:#5a5a5a">EIN</td><td style="color:#2D1A47;font-weight:700">41-4339110</td></tr>
          <tr><td style="color:#5a5a5a">Address</td><td style="color:#2D1A47">333 N New River Drive, Unit 1802<br>Fort Lauderdale, FL 33301</td></tr>
          <tr><td style="color:#5a5a5a">Tax Status</td><td style="color:#2D1A47">501(c)(3) Public Charity — IRC § 170(b)(1)(A)(vi)</td></tr>
          <tr><td style="color:#5a5a5a">Donor</td><td style="color:#2D1A47;font-weight:700">${displayName}${contactName ? ' — ' + contactName : ''}</td></tr>
          <tr><td style="color:#5a5a5a">Gift Amount</td><td style="color:#2D1A47;font-weight:700;font-size:16px">${amtFmt}</td></tr>
          <tr><td style="color:#5a5a5a">Gift Type</td><td style="color:#2D1A47">${freqStr}</td></tr>
          <tr><td style="color:#5a5a5a">Date</td><td style="color:#2D1A47">${date}</td></tr>
        </table>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e8e8e8;font-family:sans-serif;font-size:12px;color:#5a5a5a;font-style:italic;line-height:1.6">
          <strong style="color:#2D1A47">Important Tax Information:</strong> No goods or services were provided in exchange for this contribution. Your gift is tax-deductible to the full extent allowable by law under IRS regulations governing 501(c)(3) public charities. Please retain this letter as your official receipt for tax purposes.
        </div>
      </td></tr>
    </table>

    <p style="color:#5a5a5a;font-size:15px;line-height:1.75;margin-bottom:20px">
      With your support, IHAP is able to expand its reach inside correctional facilities — ensuring that more individuals leave incarceration with healthcare coverage, a care plan, and a real opportunity to build a stable life in the community.
    </p>
    <p style="color:#5a5a5a;font-size:15px;line-height:1.75">
      If you have any questions about your gift or would like to discuss partnership opportunities, please don't hesitate to reach out.
    </p>
  </td></tr>

  <!-- Signature -->
  <tr><td style="padding:0 40px 36px">
    <p style="color:#1c1c1c;font-size:15px;margin-bottom:4px">With gratitude,</p>
    <p style="color:#2D1A47;font-size:16px;font-weight:bold;margin:0">Chad R. LaBoy</p>
    <p style="color:#5a5a5a;font-family:sans-serif;font-size:13px;margin:2px 0">President &amp; Founder, IHAP Inmate Health Access Program</p>
    <p style="color:#5a5a5a;font-family:sans-serif;font-size:13px;margin:2px 0">chad@healthcred.com &nbsp;·&nbsp; (877) 390-4049 Ext 101</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1A0F2E;padding:20px 40px;text-align:center">
    <p style="font-family:sans-serif;font-size:11px;color:rgba(255,255,255,0.45);margin:0;line-height:1.7">
      IHAP Inmate Health Access Program &nbsp;·&nbsp; EIN 41-4339110 &nbsp;·&nbsp; 501(c)(3) Non-Profit<br>
      333 N New River Drive, Unit 1802, Fort Lauderdale, FL 33301
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  await transporter.sendMail({
    from:    `"IHAP — Inmate Health Access Program" <${process.env.GMAIL_USER}>`,
    to,
    subject: `Your IHAP Tax Receipt — ${amtFmt} ${freqStr}`,
    html
  });
}

async function sendChadNotification({ donorName, amountCents, frequency, email, orgName }) {
  const transporter = getTransporter();
  const amt = formatCurrency(amountCents);
  const to  = process.env.NOTIFICATION_EMAIL || 'chad@healthcred.com';

  await transporter.sendMail({
    from:    `"IHAP Portal" <${process.env.GMAIL_USER}>`,
    to,
    subject: `🎉 New IHAP Donation — ${amt} from ${orgName || donorName}`,
    text:    `New donation received!\n\nDonor: ${orgName || donorName}\nEmail: ${email}\nAmount: ${amt}\nType: ${frequency === 'monthly' ? 'Monthly' : 'One-time'}\n\nTax receipt has been sent automatically to the donor.`
  });
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type,stripe-signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  try {
    // ── Internal LOI inquiry (not from Stripe) ──
    if (event.httpMethod === 'POST' && !event.headers['stripe-signature']) {
      const body = JSON.parse(event.body || '{}');
      if (body.type === 'loi_inquiry') {
        const transporter = getTransporter();
        await transporter.sendMail({
          from:    `"IHAP Portal" <${process.env.GMAIL_USER}>`,
          to:      process.env.NOTIFICATION_EMAIL || 'chad@healthcred.com',
          subject: `IHAP Grant Inquiry — ${body.name}`,
          text:    `Foundation Grant Inquiry\n\nFoundation: ${body.name}\nContact: ${body.contact}\nEmail: ${body.email}\nFocus Areas: ${body.focus}\nGrant Range: ${body.range}`
        });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }
    }

    // ── Stripe webhook ──
    const sig    = event.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (secret && sig && !verifyStripeSignature(event.body, sig, secret)) {
      return { statusCode: 400, headers: cors, body: 'Invalid signature' };
    }

    const stripeEvent = JSON.parse(event.body);
    const type = stripeEvent.type;

    console.log('Webhook event:', type);

    if (type === 'checkout.session.completed') {
      const session  = stripeEvent.data.object;
      const meta     = session.metadata || {};
      const email    = session.customer_email || session.customer_details?.email || '';
      const amtCents = session.amount_total || parseInt(meta.amount_cents || '0');
      const donorName = meta.donor_name || 'Valued Donor';
      const frequency = meta.frequency || 'one_time';
      const orgName   = meta.org_name || '';
      const date      = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

      if (email) {
        await sendDonorReceipt({ to: email, donorName, amountCents: amtCents, frequency, date, orgName });
      }
      await sendChadNotification({ donorName, amountCents: amtCents, frequency, email, orgName });

      console.log(`Receipt sent: ${donorName} <${email}> — ${formatCurrency(amtCents)}`);
    }

    if (type === 'invoice.payment_succeeded') {
      const invoice   = stripeEvent.data.object;
      const email     = invoice.customer_email || '';
      const amtCents  = invoice.amount_paid;
      const subMeta   = invoice.subscription_details?.metadata || invoice.metadata || {};
      const donorName = subMeta.donor_name || 'Monthly Donor';
      const date      = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

      if (email && amtCents > 0) {
        await sendDonorReceipt({ to: email, donorName, amountCents: amtCents, frequency: 'monthly', date, orgName: '' });
        await sendChadNotification({ donorName, amountCents: amtCents, frequency: 'monthly', email, orgName: '' });
      }
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('stripe-webhook error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
