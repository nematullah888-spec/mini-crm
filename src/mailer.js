// مرسل بريد بسيط (SMTP) بدون مكتبات خارجية
// يدعم: المنفذ 465 (اتصال مشفّر مباشرة) والمنفذ 587 (STARTTLS)
'use strict';

const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const encHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;

function buildMessage({ from, fromName, to, subject, text }) {
  const body = b64(text).replace(/.{1,76}/g, '$&\r\n');
  const domain = (from.split('@')[1] || 'localhost');
  return [
    `From: ${fromName ? encHeader(fromName) + ' ' : ''}<${from}>`,
    `To: <${to}>`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body
  ].join('\r\n');
}

/**
 * sendMail({ host, port, user, pass, from, fromName, to, subject, text, tlsOptions, timeout })
 */
function sendMail(opt) {
  return new Promise((resolve, reject) => {
    const port = Number(opt.port) || 465;
    const implicitTLS = opt.secure != null ? !!opt.secure : port === 465;
    const tlsOpts = Object.assign(net.isIP(opt.host) ? {} : { servername: opt.host }, opt.tlsOptions || {});
    let socket;
    let buffer = '';
    let waiter = null;
    let done = false;

    const finish = err => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) { /* ignore */ }
      err ? reject(err) : resolve();
    };

    const attach = s => {
      s.setEncoding('utf8');
      s.on('data', chunk => {
        buffer += chunk;
        // الرد يكتمل عند سطر فيه رقم ثم مسافة (مو شرطة)
        const lines = buffer.split('\r\n');
        for (let i = 0; i < lines.length - 1; i++) {
          if (/^\d{3} /.test(lines[i])) {
            const reply = lines.slice(0, i + 1).join('\n');
            buffer = lines.slice(i + 1).join('\r\n');
            const w = waiter; waiter = null;
            if (w) w(reply);
            return;
          }
        }
      });
      s.on('error', e => finish(friendly(e)));
      s.setTimeout(opt.timeout || 20000, () => finish(new Error('انتهت مهلة الاتصال بخادم البريد. تأكد من الإنترنت.')));
    };

    const read = () => new Promise(r => { waiter = r; });
    const cmd = async (line, expect) => {
      if (line != null) socket.write(line + '\r\n');
      const reply = await read();
      const code = Number(reply.slice(0, 3));
      if (!expect.includes(code)) {
        const err = new Error(code === 535 || code === 534
          ? 'البريد أو كلمة مرور التطبيق غير صحيحة'
          : 'رفض خادم البريد الطلب: ' + reply.split('\n').pop());
        err.smtp = reply;
        throw err;
      }
      return reply;
    };

    const run = async () => {
      const me = os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
      await cmd(null, [220]);
      let ehlo = await cmd('EHLO ' + me, [250]);
      if (!implicitTLS) {
        if (!/STARTTLS/i.test(ehlo)) throw new Error('خادم البريد لا يدعم الاتصال المشفّر');
        await cmd('STARTTLS', [220]);
        socket.removeAllListeners('data');
        socket.setTimeout(0);
        socket = tls.connect(Object.assign({ socket }, tlsOpts));
        attach(socket);
        await new Promise((r, j) => { socket.once('secureConnect', r); socket.once('error', j); });
        ehlo = await cmd('EHLO ' + me, [250]);
      }
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(opt.user), [334]);
      await cmd(b64(opt.pass), [235]);
      await cmd(`MAIL FROM:<${opt.from}>`, [250]);
      await cmd(`RCPT TO:<${opt.to}>`, [250, 251]);
      await cmd('DATA', [354]);
      await cmd(buildMessage(opt) + '\r\n.', [250]);
      try { socket.write('QUIT\r\n'); } catch (_) { /* ignore */ }
    };

    socket = implicitTLS
      ? tls.connect(Object.assign({ host: opt.host, port }, tlsOpts))
      : net.connect({ host: opt.host, port });
    attach(socket);
    run().then(() => finish(), e => finish(e));
  });
}

function friendly(e) {
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'ECONNRESET', 'ETIMEDOUT'].includes(e.code)) {
    return new Error('تعذر الوصول لخادم البريد. تأكد أن الجهاز متصل بالإنترنت.');
  }
  return e;
}

module.exports = { sendMail, buildMessage };
