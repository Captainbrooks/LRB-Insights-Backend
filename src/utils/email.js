import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// Create a transporter object using SMTP transport

export const transporter= nodemailer.createTransport({
    service: 'Gmail',
    auth:{
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS

    }
});

// helper function to send email
export const sendEmail= async(to, subject, html)=>{
    try {

        const mailOptions={
            from:`LRB Insights <${process.env.SMTP_USER}>`,
            to,
            subject,
            html
        };

        await transporter.sendMail(mailOptions);
        console.log('Email sent to ', to);
        
    } catch (error) {
       console.error("Error sending email:", error); 
    }
}


