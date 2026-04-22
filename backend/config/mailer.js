const nodemailer = require('nodemailer');

const sendOTPEmail = async (email, otp) => {
  // Create transporter lazily so it always uses the current env vars
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  console.log(`[MAILER] Sending to: ${email}, using: ${process.env.EMAIL_USER}`);

  const mailOptions = {
    from: `"PHOENIX X" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Password Reset OTP - PHOENIX X',
    html: `
      <div style="font-family: 'Inter', sans-serif; background-color: #080808; color: #fff; padding: 40px; border-radius: 12px; border: 1px solid #d4af37;">
        <h2 style="color: #d4af37; text-align: center;">PHOENIX X</h2>
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 14px; color: #aaa;">You requested a password reset. Use the following 6-digit OTP to proceed. This code is valid for 15 minutes.</p>
        <div style="background: rgba(212, 175, 55, 0.1); border: 1px dashed #d4af37; padding: 20px; text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 10px; color: #fff;">${otp}</span>
        </div>
        <p style="font-size: 12px; color: #666; text-align: center;">If you didn't request this, please ignore this email.</p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

module.exports = { sendOTPEmail };
