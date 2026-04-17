const nodemailer = require('nodemailer');

const sendEmail = async ({ to, subject, html }) => {
  try {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
      console.warn('⚠️ EMAIL_USER or EMAIL_PASS not set in .env. Skipping email dispatch.');
      return false;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });

    const mailOptions = {
      from: `"PHOENIX X" <${user}>`,
      to: to,
      subject: subject,
      html: html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email Sent to ${to}:`, info.messageId);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error);
    return false;
  }
};

const sendAdminEmail = async ({ subject, html }) => {
  return sendEmail({
    to: 'phoenixbrothersofficial@gmail.com',
    subject: subject,
    html: html
  });
};

module.exports = { sendEmail, sendAdminEmail };
