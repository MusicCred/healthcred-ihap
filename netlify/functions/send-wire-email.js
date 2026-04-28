/**
 * IHAP Donation Portal — Netlify Function: send-wire-email.js
 *
 * Handles large gift (>$10,000) wire transfer inquiries.
 * Sends two emails via Gmail SMTP (raw TLS, no nodemailer):
 *   1. To the donor  — wire instructions + personal note from Chad
 *   2. To IHAP team  — notification of a new large gift inquiry
 *
 * Required environment variables (set in Netlify dashboard):
 *   GMAIL_USER         = the Gmail account to send FROM (e.g. info@ihapusa.org or chad@healthcred.com)
 *   GMAIL_APP_PASSWORD = 16-char Google App Password for that account
 *   NOTIFICATION_EMAIL = email to notify on new wire inquiry (chad@healthcred.com)
 */

const tls  = require('tls');
const net  = require('net');

// ── Minimal SMTP-over-TLS sender (no npm deps needed) ────────────────────────
function sendEmail({ user, pass, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const host = 'smtp.gmail.com';
    const port = 465;

    const b64 = (s) => Buffer.from(s).toString('base64');
    const boundary = 'ihap_mime_' + Date.now();

    const rawMsg = [
      `From: "IHAP — Inmate Health Access Program" <${user}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64(html),
      `--${boundary}--`,
    ].join('\r\n');

    let sock;
    let buf = '';
    let step = 0;

    const send = (s) => sock.write(s + '\r\n');

    const next = () => {
      step++;
      switch (step) {
        case 1: send(`EHLO smtp.gmail.com`); break;
        case 2: send(`AUTH LOGIN`); break;
        case 3: send(b64(user)); break;
        case 4: send(b64(pass)); break;
        case 5: send(`MAIL FROM:<${user}>`); break;
        case 6: send(`RCPT TO:<${to}>`); break;
        case 7: send(`DATA`); break;
        case 8: send(rawMsg + '\r\n.'); break;
        case 9: send(`QUIT`); resolve('sent'); break;
      }
    };

    sock = tls.connect({ host, port, servername: host }, () => next());

    sock.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\r\n');
      buf = lines.pop();
      lines.forEach((line) => {
        const code = parseInt(line, 10);
        if (!isNaN(code) && code >= 400) { reject(new Error('SMTP error: ' + line)); return; }
        if (!isNaN(code) && (code === 220 || code === 235 || code === 250 || code === 334 || code === 354 || code === 221)) {
          if (code === 334 && step === 2) next(); // AUTH LOGIN — send user
          else if (code === 334 && step === 3) next(); // sent user — send pass
          else if (code !== 334) next();
        }
      });
    });

    sock.on('error', reject);
    setTimeout(() => reject(new Error('SMTP timeout')), 15000);
  });
}

// ── HTML email templates ──────────────────────────────────────────────────────
function donorEmailHtml({ firstName, amount, refCode }) {
  const fmtAmt = '$' + Number(amount).toLocaleString('en-US');
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f0;font-family:Georgia,serif">
<div style="max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0D3320 0%,#1a5c38 100%);padding:36px 40px 30px;text-align:center">
    <div style="font-size:2rem;margin-bottom:6px">💚</div>
    <div style="font-family:Arial,sans-serif;font-size:1.4rem;font-weight:900;color:#fff;letter-spacing:.5px">
      Thank You, ${firstName}
    </div>
    <div style="font-family:Arial,sans-serif;font-size:.85rem;color:rgba(255,255,255,.7);margin-top:6px">
      Inmate Health Access Program &nbsp;·&nbsp; EIN 41-4339110
    </div>
  </div>

  <!-- Personal note from Chad -->
  <div style="padding:32px 40px 24px;border-bottom:1px solid #eef2ea">
    <p style="font-size:1.05rem;color:#1a1a1a;line-height:1.75;margin:0 0 16px">
      ${firstName},
    </p>
    <p style="font-size:1rem;color:#333;line-height:1.8;margin:0 0 16px">
      I started IHAP because after two years of running HealthCred inside correctional facilities across Florida, Georgia, and Alabama, I kept seeing the same thing: people would leave with coverage, but nowhere to go.
    </p>
    <p style="font-size:1rem;color:#333;line-height:1.8;margin:0 0 16px">
      A gift of ${fmtAmt} is the kind of commitment that moves the needle — it funds real reentry coordination, real training for facility staff, and real connections to housing, mental health, and job programs for people who genuinely have no other on-ramp.
    </p>
    <p style="font-size:1rem;color:#333;line-height:1.8;margin:0 0 4px">
      This means everything. Thank you for being part of this.
    </p>
    <p style="font-size:1rem;color:#333;line-height:1.8;margin:0 0 24px">
      — Chad R. LaBoy<br>
      <span style="font-size:.85rem;color:#888">Founder &amp; President, Inmate Health Access Program (IHAP)</span>
    </p>
  </div>

  <!-- Wire instructions -->
  <div style="padding:28px 40px">
    <div style="font-family:Arial,sans-serif;font-size:1rem;font-weight:800;color:#0D3320;margin-bottom:18px;text-transform:uppercase;letter-spacing:.5px">
      Wire Transfer Instructions
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:.92rem">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:40%">Bank</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-weight:700">Truist Bank</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888">Account Name</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-weight:700">Inmate Health Access Program (IHAP)</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888">Routing Number</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-weight:700">263191387</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888">Account Number</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-weight:700">1100035610039</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888">Gift Amount</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#1a1a1a;font-weight:700">${fmtAmt}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888">Reference / Memo</td>
        <td style="padding:10px 0;color:#1a1a1a;font-weight:700">${refCode}</td>
      </tr>
    </table>

    <div style="margin-top:20px;padding:14px 16px;background:#f6fdf8;border-radius:10px;
         border-left:4px solid #0D3320;font-size:.85rem;color:#1a4a2a;line-height:1.6">
      <strong>Next step:</strong> Initiate the wire using the details above. Please include your reference code in the memo field. Chad will follow up personally once the gift is received.
    </div>

    <div style="margin-top:24px;padding:16px;background:#f6fdf8;border-radius:10px;font-size:.83rem;color:#555;line-height:1.6;text-align:center">
      IHAP is a 501(c)(3) public charity · EIN 41-4339110<br>
      333 N New River Drive, Unit 1802, Fort Lauderdale, FL 33301<br>
      <a href="mailto:info@ihapusa.org" style="color:#0D3320">info@ihapusa.org</a> &nbsp;·&nbsp;
      <a href="https://ihapusa.org" style="color:#0D3320">ihapusa.org</a><br><br>
      No goods or services were provided in exchange for this contribution.
    </div>
  </div>

</div>
</body>
</html>`;
}

function notifyEmailHtml({ firstName, lastName, email, phone, org, amount, message }) {
  const fmtAmt = '$' + Number(amount).toLocaleString('en-US');
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px">
<h2 style="color:#0D3320">🎉 New Large Gift Inquiry — ${fmtAmt}</h2>
<table style="border-collapse:collapse;width:100%;max-width:500px">
  <tr><td style="padding:8px 12px;background:#f4f4f4;font-weight:700;width:35%">Name</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${firstName} ${lastName}</td></tr>
  <tr><td style="padding:8px 12px;background:#f4f4f4;font-weight:700">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
  <tr><td style="padding:8px 12px;background:#f4f4f4;font-weight:700">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${phone || '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f4f4f4;font-weight:700">Organization</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${org || '—'}</td></tr>
  <tr><td style="padding:8px 12px;background:#f4f4f4;font-weight:700">Gift Amount</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#0D3320;font-weight:700">${fmtAmt}</td></tr>
  <tr><td style="padding:8px 12px;background:#f4f4f4;font-weight:700">Message</td><td style="padding:8px 12px">${message || '—'}</td></tr>
</table>
<p style="margin-top:20px;color:#555;font-size:.85rem">Wire instructions email sent to ${email}. Truist details included: Routing 263191387, Account 1100035610039.</p>
</body></html>`;
}

// ── Lambda handler ────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const GMAIL_USER  = process.env.GMAIL_USER;
  const GMAIL_PASS  = process.env.GMAIL_APP_PASSWORD;
  const NOTIFY_TO   = process.env.NOTIFICATION_EMAIL || 'chad@healthcred.com';

  if (!GMAIL_USER || !GMAIL_PASS) {
    // Fail gracefully — log the inquiry but don't crash the user experience
    console.error('GMAIL_USER or GMAIL_APP_PASSWORD not set');
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, warning: 'email_not_configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { firstName, lastName, email, phone, org, amount, message } = body;

  if (!firstName || !email || !amount) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'firstName, email, and amount are required' }) };
  }

  const refCode = `${firstName.toUpperCase().slice(0,4)}${Date.now().toString().slice(-6)} IHAP GIFT`;

  try {
    // 1. Email to donor
    await sendEmail({
      user: GMAIL_USER,
      pass: GMAIL_PASS,
      to:   email,
      subject: `Thank you, ${firstName} — Your IHAP Wire Instructions`,
      html: donorEmailHtml({ firstName, amount, refCode }),
    });

    // 2. Notify Chad / team
    await sendEmail({
      user: GMAIL_USER,
      pass: GMAIL_PASS,
      to:   NOTIFY_TO,
      subject: `🎉 New Wire Gift Inquiry — $${Number(amount).toLocaleString()} from ${firstName} ${lastName}`,
      html: notifyEmailHtml({ firstName, lastName, email, phone, org, amount, message }),
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, refCode }),
    };
  } catch (err) {
    console.error('Email send error:', err.message);
    // Still return success to the donor — we log internally and Chad can follow up
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, warning: 'email_error', refCode }),
    };
  }
};
