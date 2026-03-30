const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');

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
  // Increase timeouts to accommodate slower network from cloud providers
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 20000,
  });
};

const isEmailConfigured = () => {
  return Boolean(process.env.SENDGRID_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER));
};

const formatCompetitionDate = (dateString) => {
  if (!dateString) return '-';

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat('fi-FI', { dateStyle: 'long' }).format(date);
};

const formatCompetitionDateRange = (startDate, endDate) => {
  const formattedStart = formatCompetitionDate(startDate);
  const formattedEnd = formatCompetitionDate(endDate || startDate);

  if (formattedStart === formattedEnd) {
    return formattedStart;
  }

  return `${formattedStart} - ${formattedEnd}`;
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
          h1 { margin: 0; font-size: 24px; color: #ffffff; }
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
          h1 { margin: 0; font-size: 24px; color: #ffffff !important; }
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

  competitionAnnouncement: (firstName, competition) => {
    const competitionName = competition?.name || 'Uusi kilpailu Suomessa';
    const competitionCity = competition?.city || competition?.venue_city || 'Suomi';
    const competitionDate = formatCompetitionDateRange(
      competition?.start_date,
      competition?.end_date
    );
    const competitionUrl = competition?.id
      ? `https://www.worldcubeassociation.org/competitions/${competition.id}`
      : 'https://www.worldcubeassociation.org/competitions?region=Finland';

    return {
      subject: `Uusi WCA-kilpailu Suomessa: ${competitionName}`,
      html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
        <style>
          :root { color-scheme: light; supported-color-schemes: light; }
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #152f54 0%, #003d93 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .footer { background: #152f54; color: #9ca3af; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #003d93; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 12px 0; }
          .info-box { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-top: 14px; }
          h1 { margin: 0; font-size: 24px; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; }
          .header h1, .header-title { color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); }
          @media (prefers-color-scheme: dark) {
            .header, .header * { color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="header-title" style="margin: 0; font-size: 24px; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important;">Uusi kilpailu Suomessa!</h1>
          </div>
          <div class="content">
            <p>Hei ${firstName || 'speedcuber'}!</p>
            <p>Suomeen on lisätty uusi tuleva WCA-kilpailu:</p>
            <div class="info-box">
              <p><strong>Kilpailu:</strong> ${competitionName}</p>
              <p><strong>Kaupunki:</strong> ${competitionCity}</p>
              <p><strong>Päivämäärä:</strong> ${competitionDate}</p>
            </div>
            <p>
              <a href="${competitionUrl}" class="button">Avaa kilpailusivu</a>
            </p>
            <p>Lisätiedot, aikataulu ja ilmoittautuminen löytyvät kilpailusivulta.</p>
            <p>Ystävällisin terveisin,<br><strong>Speedcubing Finland ry</strong></p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Speedcubing Finland ry</p>
            <p>Tämä on automaattinen viesti.</p>
          </div>
        </div>
      </body>
      </html>
    `,
      text: `
Hei ${firstName || 'speedcuber'}!

Suomeen on lisätty uusi tuleva WCA-kilpailu:

- Kilpailu: ${competitionName}
- Kaupunki: ${competitionCity}
- Päivämäärä: ${competitionDate}
- Linkki: ${competitionUrl}

Lisätiedot, aikataulu ja ilmoittautuminen löytyvät kilpailusivulta.

Ystävällisin terveisin,
Speedcubing Finland ry
    `,
    };
  },
};

// Send email function
const sendEmail = async (to, template, ...templateArgs) => {
  // Check if email is configured
  // Prefer SendGrid API if configured (better reliability on Render)
  if (process.env.SENDGRID_API_KEY) {
    try {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const emailContent = emailTemplates[template](...templateArgs);
      const msg = {
        to,
        from: process.env.SMTP_FROM || process.env.SENDGRID_FROM || process.env.SMTP_USER,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      };
      const result = await sgMail.send(msg);
      console.log(`SendGrid email sent to ${to}`);
      return { success: true, result };
    } catch (err) {
      console.error('SendGrid send error:', err);
      // fallthrough to try SMTP if available
    }
  }

  if (!isEmailConfigured() || !process.env.SMTP_HOST || !process.env.SMTP_USER) {
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

const sendCompetitionAnnouncementEmail = (email, firstName, competition) => {
  return sendEmail(email, 'competitionAnnouncement', firstName, competition);
};

module.exports = {
  sendEmail,
  sendRegistrationPendingEmail,
  sendRegistrationApprovedEmail,
  sendCompetitionAnnouncementEmail,
  isEmailConfigured,
};
