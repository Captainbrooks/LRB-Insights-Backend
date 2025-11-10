import express from "express";
import {google} from "googleapis";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

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

//step 1: redirect user to Consent Screen

// api/google/auth


// asking google for permission

router.get("/auth",(req,res)=>{
    const url=oauth2Client.generateAuthUrl({
        access_type:"offline",
        scope:["https://www.googleapis.com/auth/analytics.readonly"],
        prompt:"consent"
    });
    res.redirect(url)
})



// google reodirects here after user grants permission with one time like code
// step 2: Handle Callback

router.get("/callback",async(req,res)=>{

    try {
        const {code}=req.query;

        // exchange code for tokens

    const {tokens}=await oauth2Client.getToken(code);

    console.log("Tokens:", tokens);

    // set the credentials
    oauth2Client.setCredentials(tokens);
    // store the tokens in a file
    fs.writeFileSync(tokensPath,JSON.stringify(tokens));
    res.send("Google Analytics Authentication Successful");
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
