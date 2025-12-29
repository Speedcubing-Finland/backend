const nodemailer = require('nodemailer');

// Create reusable transporter object using SMTP
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Email templates
const emailTemplates = {
  registrationPending: (firstName, lastName, city, email, wcaId, birthDate) => ({
    subject: 'Jäsenhakemuksesi on vastaanotettu - Speedcubing Finland',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #152f54 0%, #003d93 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .footer { background: #152f54; color: #9ca3af; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
          .highlight { color: #5ea3ff; font-weight: bold; }
          h1 { margin: 0; font-size: 24px; }
          .emoji { font-size: 48px; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Speedcubing Finland</h1>
          </div>
          <div class="content">
            <h2>Hei ${firstName}!</h2>
            <p>Kiitos jäsenhakemuksestasi <span class="highlight">Speedcubing Finland ry</span>:hyn!</p>
            <p>Olemme vastaanottaneet hakemuksesi ja se odottaa nyt hallituksen hyväksyntää. Käsittelemme hakemukset yleensä muutaman viikon sisällä, mutta kuitenkin aina viimeistään ennen kilpailuja.</p>
            <p>Saat uuden sähköpostin, kun hakemuksesi on käsitelty.</p>
            <p><strong>Hakemuksen tiedot:</strong></p>
            <ul>
              <li><strong>Nimi:</strong> ${firstName} ${lastName}</li>
              <li><strong>Kaupunki:</strong> ${city}</li>
              <li><strong>Sähköposti:</strong> ${email}</li>
              <li><strong>WCA ID:</strong> ${wcaId ? wcaId : '-'}</li>
              <li><strong>Syntymäaika:</strong> ${birthDate}</li>
            </ul>
            <p>Jos sinulla on kysyttävää, voit ottaa yhteyttä osoitteeseen <a href="mailto:hallitus@speedcubingfinland.fi">hallitus@speedcubingfinland.fi</a>.</p>
            <p>Ystävällisin terveisin,<br><strong>Speedcubing Finland ry</strong></p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Speedcubing Finland ry</p>
            <p>Tämä on automaattinen viesti, älä vastaa tähän sähköpostiin.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hei ${firstName}!

Kiitos jäsenhakemuksestasi Speedcubing Finland ry:hyn!

Olemme vastaanottaneet hakemuksesi ja se odottaa nyt hallituksen hyväksyntää. Käsittelemme hakemukset yleensä muutaman viikon sisällä, mutta kuitenkin aina viimeistään ennen kilpailuja.

Saat uuden sähköpostin, kun hakemuksesi on käsitelty.

Hakemuksen tiedot:
- Nimi: ${firstName} ${lastName}
- Kaupunki: ${city}
- Sähköposti: ${email}
- WCA ID: ${wcaId ? wcaId : '-'}
- Syntymäaika: ${birthDate}

Jos sinulla on kysyttävää, voit ottaa yhteyttä osoitteeseen hallitus@speedcubingfinland.fi.

Ystävällisin terveisin,
Speedcubing Finland ry
    `,
  }),

  registrationApproved: (firstName, lastName) => ({
    subject: 'Tervetuloa jäseneksi! - Speedcubing Finland',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #152f54 0%, #003d93 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .footer { background: #152f54; color: #9ca3af; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
          .highlight { color: #5ea3ff; font-weight: bold; }
          .button { display: inline-block; background: #003d93; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
          h1 { margin: 0; font-size: 24px; }
          .emoji { font-size: 48px; margin-bottom: 10px; }
          .benefits { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
          .benefits li { margin: 8px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="emoji">🎉</div>
            <h1>Tervetuloa jäseneksi!</h1>
          </div>
          <div class="content">
            <h2>Hei ${firstName}!</h2>
            <p>Hienoja uutisia! Jäsenhakemuksesi <span class="highlight">Speedcubing Finland ry</span>:hyn on hyväksytty!</p>
            <p>Olet nyt virallisesti Suomen speedcubing-yhteisön jäsen. 🧩</p>
            
            <div class="benefits">
              <p><strong>Jäsenenä:</strong></p>
              <ul>
                <li>📊 Saat äänioikeuden yhdistyksen kokouksissa</li>
                <li>💰 Saat alennuksia kilpailumaksuista</li>
                <li>👥 Pääset tutustumaan aktiiviseen speedcubing-yhteisöön</li>
              </ul>
            </div>
            
            <p>Jos sinulla on kysyttävää, voit ottaa yhteyttä osoitteeseen <a href="mailto:hallitus@speedcubingfinland.fi">hallitus@speedcubingfinland.fi</a>.</p>
            <p>Ystävällisin terveisin,<br><strong>Speedcubing Finland ry</strong></p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Speedcubing Finland ry</p>
            <p>Tämä on automaattinen viesti, älä vastaa tähän sähköpostiin.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Hei ${firstName}!

Hienoja uutisia! Jäsenhakemuksesi Speedcubing Finland ry:een on hyväksytty!

Olet nyt virallisesti Suomen nopeusratkaisijayhteisön jäsen.

Jäsenenä:
- Saat äänioikeuden yhdistyksen kokouksissa
- Saat alennuksia kilpailumaksuista
- Pääset tutustumaan aktiiviseen speedcubing-yhteisöön

Jos sinulla on kysyttävää, voit ottaa yhteyttä osoitteeseen hallitus@speedcubingfinland.fi.

Ystävällisin terveisin,
Speedcubing Finland ry
    `,
  }),
};

// Send email function
const sendEmail = async (to, template, ...templateArgs) => {
  // Check if email is configured
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('Email not configured - skipping email send');
    return { success: false, reason: 'Email not configured' };
  }

  try {
    const transporter = createTransporter();
    const emailContent = emailTemplates[template](...templateArgs);

    const mailOptions = {
      from: `"Speedcubing Finland" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

// Convenience functions
const sendRegistrationPendingEmail = (email, firstName, lastName, city, emailAddr, wcaId, birthDate) => {
  return sendEmail(email, 'registrationPending', firstName, lastName, city, emailAddr, wcaId, birthDate);
};

const sendRegistrationApprovedEmail = (email, firstName, lastName) => {
  return sendEmail(email, 'registrationApproved', firstName, lastName);
};

module.exports = {
  sendEmail,
  sendRegistrationPendingEmail,
  sendRegistrationApprovedEmail,
};
