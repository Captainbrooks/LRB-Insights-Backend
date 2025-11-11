import express from "express";
import {google} from "googleapis";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import querystring from "querystring";
import { sendEmail } from "../utils/email.js";
import Client from "../models/client.model.js";

dotenv.config();

const router = express.Router();

const credentialsPath = path.resolve("credentials.json");
const tokensPath = path.resolve("tokens.json");

const keys=JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));

const oauth2Client = new google.auth.OAuth2(
  keys.web.client_id,
  keys.web.client_secret,
  "http://localhost:7000/api/google/callback"
  
);



// google scopes

const scopes = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  "openid",
  "email",
  "profile",
]




// 



//step 1: redirect user to Consent Screen

// api/google/auth


// asking google for permission

router.get("/auth", async(req,res)=>{


  const { clientId } = req.query;

   if(!clientId){
    return res.status(400).send("clientId query parameter is required");
  }

  try {
     const url=oauth2Client.generateAuthUrl({
        access_type:"offline",
        scope:scopes,
        prompt:"consent",
        state: JSON.stringify({ clientId }),
    });

    const client=await Client.findById(clientId);
    if(!client){
        return res.status(404).send("Client not found");
    }

    await sendEmail(
      client.clientEmail,
      "Connect your Google Account to LRB Insights",
      `<p>Hello ${client.clientName},</p>
       <p>Click <a href="${url}" target="_blank">here</a> to securely connect your Google account with LRB Insights.</p>
       <p>This allows your analytics data to sync automatically.</p>`
    );

    console.log("Google OAuth link sent to:", client.clientEmail);
    res.json({ success: true, message: "Google OAuth link sent to client email." });
  } catch (error) {
    console.error("Error sending Google OAuth link:", error);
    res.status(500).json({ error: "Failed to send Google OAuth link" });
  }

 
})



// google reodirects here after user grants permission with one time like code
// step 2: Handle Callback

router.get("/callback",async(req,res)=>{

    try {
        const {code, state}=req.query;

        const { clientId } = JSON.parse(state || '{}' );

        // exchange code for tokens

    const {tokens}=await oauth2Client.getToken(code);

    console.log("Tokens:", tokens);

    // set the credentials
    oauth2Client.setCredentials(tokens);
    // store the tokens in a file
    fs.writeFileSync(tokensPath,JSON.stringify(tokens));

    const client= await Client.findById(clientId);
    if(!client){
        return res.status(404).send("Client not found");
    }

    client.platformConnections = client.platformConnections || [];

    const existingConnection=client.platformConnections.find(conn => conn.name === "Google");

    if(existingConnection){
        existingConnection.status="Connected";
        existingConnection.connectedAt=new Date();
    }else{
        client.platformConnections.push({
            name:"Google", 
            status:"Connected",
            connectedAt:new Date()
        });
    }

    await client.save();

    console.log(`Google account connected for client: ${client.clientName} (${client._id})`);



    res.send("Google Account connected successfully! You can close this tab.");
    } catch (error) {

        console.error("Error during OAuth callback:", error);
    res.status(500).send("❌ Authentication failed. Check console for details.");
        
    }
    
})



router.get("/properties", async(req,res)=>{
    try{

         // read the tokens from the file
    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    oauth2Client.setCredentials(tokens);

    const admin=google.analyticsadmin({
        version:"v1beta",
        auth:oauth2Client
    });

    // list all accessible accounts + properties
    const summaries=await admin.accountSummaries.list();
    const properties=summaries.data.accountSummaries?.flatMap(account =>
      account.propertySummaries.map(p => ({
        accountName: account.displayName,
        propertyName: p.displayName,
        propertyId: p.property.split("/")[1],
      }))
    );

    res.json(properties || []);


        
    }catch(error){{

console.error("Error listing properties:", err);
    res.status(500).json({ error: "Failed to list GA4 properties" });
    }}
})


router.get("/analytics", async (req, res) => {
  try {

    // read the tokens from the file
    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    oauth2Client.setCredentials(tokens);



    const admin=google.analyticsadmin({
        version:"v1beta",
        auth:oauth2Client
    });

    const summaries=await admin.accountSummaries.list();
    


    // create analytics data client
    const analyticsData = google.analyticsdata({
      version: "v1beta",
      auth: oauth2Client,
    });

    const propertyId = req.query.propertyId; // example: ?propertyId=123456789

    const response = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "2025-11-01", endDate: "today" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
        ],
        dimensions: [{ name: "date" }],
      },
    });

    res.json(response.data);
  } catch (err) {
    console.error("Error fetching analytics data:", err);
    res.status(500).json({ error: "Failed to fetch analytics data" });
  }
});



export default router;
