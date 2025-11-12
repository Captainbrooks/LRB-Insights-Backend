import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import querystring from "querystring";
import { sendEmail } from "../utils/email.js";
import Client from "../models/client.model.js";
import Token from "../models/token.model.js";
import { GoogleAdsApi } from "google-ads-api";
import { error } from "console";



dotenv.config();

const router = express.Router();



// Create a fresh OAuth2 client factory
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}



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









//step 1: redirect user to Consent Screen



// asking google for permission

router.get("/auth", async (req, res) => {


  const { clientId } = req.query;

  if (!clientId) {
    return res.status(400).send("clientId query parameter is required");
  }

  try {

    const oauth2Client = createOAuthClient();


    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      state: JSON.stringify({ clientId }),
    });

    const client = await Client.findById(clientId);
    if (!client) {
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

router.get("/callback", async (req, res) => {

  try {
    const { code, state } = req.query;

    const { clientId } = JSON.parse(state || '{}');

    if (!clientId) {
      return res.status(400).send("clientId is required in state");
    }



    const oauth2Client = createOAuthClient();


    // exchange code for tokens

    const { tokens } = await oauth2Client.getToken(code);


    // set the credentials
    oauth2Client.setCredentials(tokens);


    // Find client in DB
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).send("Client not found");


    // updating the client connection status of the platform

    client.platformConnections = client.platformConnections || [];

    const existingConnection = client.platformConnections.find(conn => conn.name === "Google")

    if (existingConnection) {
      existingConnection.status = "Connected";
      existingConnection.connectedAt = new Date();
    } else {
      client.platformConnections.push({
        name: "Google",
        status: "Connected",
        connectedAt: new Date()
      });
    }








  // fetch all Google Account IDs

    await client.save();

    // storing the tokens in DB

    const existingToken = await Token.findOne({ clientId: client._id, platform: "Google" });

    if (existingToken) {
      existingToken.access_token = tokens.access_token;
      existingToken.refresh_token = tokens.refresh_token || existingToken.refresh_token; // only update if new refresh token is provided
      existingToken.expiry_date = tokens.expiry_date;
      await existingToken.save();
      console.log("Existing token updated for client:", client.clientName);
    } else {

      await Token.create({
        clientId,
        platform: "Google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date
      });

      console.log("New token created for client:", client.clientName);


    }

    console.log(`Google account connected for client: ${client.clientName} (${client._id})`);



    try {
      const resources = await fetchGoogleResources(clientId);
      client.googleAccounts = resources;
      await client.save();
      console.log("✅ Stored Google resources:", resources);
    } catch (fetchErr) {
      console.error("⚠️ Failed to fetch Google resources:", fetchErr.message);
    }



    res.send(`
      <h2>✅ Google account connected successfully!</h2>
      <p>Your Google Ads, Analytics, Search Console, and YouTube accounts are now linked.</p>
      <p>You can close this window and return to the LRB Insights dashboard.</p>
    `);
  } catch (error) {

    console.error("Error during OAuth callback:", error);
    res.status(500).send("❌ Authentication failed. Check console for details.");

  }

})




// helper function to new access token using refresh token

export async function getAuthorizedClient(clientId) {
  try {
    const token = await Token.findOne({ clientId, platform: "Google" });
    if (!token) {
      console.error("No Google token found for client:", clientId);
      return null;
    }

    // create a new OAuth client instance here
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // assign saved credentials
    oauth2Client.setCredentials({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expiry_date: token.expiry_date,
    });

    // check if expired (within 60 seconds)
    const now = Date.now();
    if (token.expiry_date && now >= token.expiry_date - 60 * 1000) {
      console.log("Access token expired or near expiry — refreshing...");
      const { credentials } = await oauth2Client.refreshAccessToken().catch(async () => {
  const refreshed = await oauth2Client.getAccessToken();
  return { credentials: { access_token: refreshed.token } };
});

      oauth2Client.setCredentials(credentials);

      // update DB
      token.access_token = credentials.access_token;
      token.expiry_date = credentials.expiry_date;
      await token.save();

      console.log("Refreshed Google access token for client:", clientId);
    }

    return oauth2Client;
  } catch (error) {
    console.error("Error authorizing Google client:", error);
    return null;
  }
}





// revoke the google access

router.post("/disconnect", async (req, res) => {
  try {

    const { clientId } = req.body;

    if (!clientId) {
      return res.status(400).send("clientId is required");
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).send("Client not found");
    }



    const tokenDoc = await Token.findOne({ clientId, platform: "Google" });
    if (!tokenDoc) {
      return res.status(404).send("No Google token found for this client");
    }

    const oauth2Client = createOAuthClient();

    oauth2Client.setCredentials({
      access_token: tokenDoc.access_token,
      refresh_token: tokenDoc.refresh_token,
    });




    // revoking the token

    await oauth2Client.revokeToken(tokenDoc.refresh_token || tokenDoc.access_token);
    console.log("Revoked Google Access token for a client:", client.clientName);

    // cleaning up the client platform connection status

    await Token.deleteOne({ clientId: client._id, platform: "Google" });
    console.log("Deleted Google token from DB for client:", client.clientName);


    // Update client connection status
    if (client.platformConnections?.length) {
      const googleConn = client.platformConnections.find((p) => p.name === "Google");
      if (googleConn) {
        googleConn.status = "Not Connected";
        googleConn.connectedAt = null;
      }
      await client.save();
    }


    res.json({ success: true, message: `Google disconnected for ${client.clientName}` });






  } catch (error) {

    console.error("Error disconnecting Google account:", error);
    res.status(500).json({ error: "Failed to disconnect Google account" });

  }
})







export async function fetchGA4Properties(clientId){
    const auth = await getAuthorizedClient(clientId);

    const admin= google.analyticsadmin({version: 'v1beta', auth});

    const accountsResponse= await admin.accounts.list();

    const account = accountsResponse.data.accounts?.[0];

    if(!account){
        return [];
    }

    const propertiesResponse= await admin.properties.list({
        filter:`parent:${account.name}`
    });

    const properties=propertiesResponse.data.properties?.map((p)=>(
        {
            id:p.name.replace("properties/", ""),
            name:p.displayName,    
            
        }
    ))

    return properties || [];
}




export async function fetchGoogleAdsAccounts(clientId) {
  try {
    const token = await Token.findOne({ clientId, platform: "Google" });
    if (!token) throw new Error("No Google token found for Ads");

    const client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    const customer = client.Customer({
      customer_id: process.env.GOOGLE_LOGIN_CUSTOMER_ID, // your MCC
      login_customer_id: process.env.GOOGLE_LOGIN_CUSTOMER_ID, // same MCC
      refresh_token: token.refresh_token,
    });

    // Lists non-manager accounts (the actual ad accounts you can report on)
    const query = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.manager
      FROM customer
      WHERE customer.manager = FALSE
      ORDER BY customer.id
    `;

    const rows = await customer.query(query);

    return rows.map(r => ({
      id: r.customer.id,                         // ← this is the client customer_id you’ll report on
      name: r.customer.descriptive_name || null,
      currency: r.customer.currency_code || null,
      timeZone: r.customer.time_zone || null,
      status: "ACTIVE",
      type: "SEARCH",
    }));
  } catch (err) {
    console.error("Error fetching Ads accounts:", err);
    return [];
  }
}



export async function fetchSearchConsoleSites(clientId) {
  const auth = await getAuthorizedClient(clientId);
  const webmasters = google.webmasters({ version: "v3", auth });

  const response = await webmasters.sites.list();
  const sites = response.data.siteEntry || [];

  return sites.map((s) => ({
    url: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
}




export async function fetchYouTubeChannels(clientId) {
  const auth = await getAuthorizedClient(clientId);
  const youtube = google.youtube({ version: "v3", auth });

  const response = await youtube.channels.list({
    part: "id,snippet",
    mine: true,
  });

  return response.data.items?.map((ch) => ({
    id: ch.id,
    title: ch.snippet.title,
  })) || [];
}




export async function fetchGoogleResources(clientId) {
  const auth = await getAuthorizedClient(clientId);
  if (!auth) throw new Error("No valid Google token found");

  const [ga4, ads, search, youtube] = await Promise.all([
    fetchGA4Properties(clientId),
    fetchGoogleAdsAccounts(clientId),
    fetchSearchConsoleSites(clientId),
    fetchYouTubeChannels(clientId),
  ]);

  return {
    ga4PropertyId: ga4?.[0]?.id || null,
    googleAdsAccountId: ads?.[0] || null,
    searchConsoleSite: search?.[0]?.url || null,
    youtubeChannelId: youtube?.[0]?.id || null,
  };
}




router.get("/accounts/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const resources = await fetchGoogleResources(clientId);
    client.googleAccounts = resources;
    await client.save();

    res.json({ success: true, message: "Google account data refreshed", data: resources });
  } catch (err) {
    console.error("Error refreshing Google data:", err);
    res.status(500).json({ error: "Failed to refresh Google data" });
  }
});










router.get("/ga4/properties/:clientId", async(req,res)=>{

  try {

    const {clientId}=req.params;

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const properties=await fetchGA4Properties(clientId)
    const selected=client.googleAccounts?.ga4PropertyId || null;

    res.json({success:true, properties, selected})
    
  } catch (error) {

    console.log("Error fetching ga4 properties", error.message)
    res.status(500).json({error:"failed to fetch ga4 properties"})
    
  }
})



router.post("/ga4/select-property", async(req,res)=>{
  try {

    const {clientId, propertyId, propertyName}=req.body;

    console.log(req.body)

    if(!clientId || !propertyId){
      return res.status(400).json({error:"Client ID and Property ID required."});
    }

    const client= await Client.findById(clientId);
    if(!client) return res.status(404).json({error:"Client not found"});

    client.googleAccounts=client.googleAccounts || {};
    client.googleAccounts.ga4PropertyId= propertyId;
    client.googleAccounts.ga4PropertyName=propertyName;

    await client.save();

    console.log("property saved succcessfully.")

    res.json({success: true, message: "GA4 property saved successfully"})
    
  } catch (error) {
    console.error("Error selecting GA4 property:", err);
    res.status(500).json({ error: "Failed to save GA4 property" });
  }
})





// fetching the metrics for the property

router.get("/ga4/metrics/:clientId", async(req,res)=>{

  console.log("metrics reached")
  try {
    const {clientId}=req.params;
    const client = await Client.findById(clientId);

    console.log("client", client);

    if (!client?.googleAccounts?.ga4PropertyId) {
      return res.status(400).json({ error: "No GA4 property selected for this client" });
    }

    const auth=await getAuthorizedClient(clientId);
    if(!auth){
      return res.status(401).json({ error: "Google authorization failed" });
    }

    console.log("GA4 Property ID:", client.googleAccounts.ga4PropertyId);


    const analyticsData = google.analyticsdata("v1beta");

    const response= await analyticsData.properties.runReport({
      property:`properties/${client.googleAccounts.ga4PropertyId}`,
      requestBody:{
        dateRanges:[{startDate:'7daysAgo', endDate:"today"}],
        metrics:[
          {name:"sessions"},
          {name:"totalUsers"},
          {name:"screenPageViews"},
          {name:"bounceRate"},
        ],
        dimensions:[{name:"date"}]
      },
      auth
    });

    console.log("data", response.data)

    res.json({success:true, data:response.data})


    
  } catch (error) {

    console.error("Error fetching GA4 metrics:", error.message);
    res.status(500).json({ error: "Failed to fetch GA4 metrics" });
    
  }
})




router.get("/search-console/sites/:clientId", async(req,res)=>{
  try {
    const {clientId}=req.params;

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const sites = await fetchSearchConsoleSites(clientId);
    const selected=client.googleAccounts?.searchConsoleSite || null;

    res.json({success:true, sites, selected});




    
  } catch (error) {

    console.error("Error fetching Search Console sites:", err);
    res.status(500).json({ error: "Failed to fetch Search Console sites" });
    
  }
});





router.post("/search-console/select-site", async (req, res) => {
  try {
    const { clientId, siteUrl } = req.body;
    if (!clientId || !siteUrl)
      return res.status(400).json({ error: "clientId and siteUrl required" });

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });

    client.googleAccounts = client.googleAccounts || {};
    client.googleAccounts.searchConsoleSite = siteUrl;
    await client.save();

    res.json({ success: true, message: "Search Console site saved successfully" });
  } catch (err) {
    console.error("Error saving Search Console site:", err);
    res.status(500).json({ error: "Failed to save Search Console site" });
  }
});



router.get("/search-console/metrics/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await Client.findById(clientId);

    if (!client?.googleAccounts?.searchConsoleSite)
      return res.status(400).json({ error: "No Search Console site selected" });

    const auth = await getAuthorizedClient(clientId);
    const webmasters = google.searchconsole({ version: "v1", auth });

    const response = await webmasters.searchanalytics.query({
      siteUrl: client.googleAccounts.searchConsoleSite,
      requestBody: {
        startDate: "2025-10-01",
        endDate: "2025-10-31",
        dimensions: ["date"],
        metrics: ["clicks", "impressions", "ctr", "position"],
      },
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error fetching Search Console metrics:", error.message);
    res.status(500).json({ error: "Failed to fetch Search Console metrics" });
  }
});





router.get("/youtube/metrics/:clientId", async(req,res)=>{
  try {

    const { clientId}= req.params;

    const client= await Client.findById(clientId);

    if(!client?.googleAccounts?.youtubeChannelId){
      return res.status(400).json({error:"No Youtube Channel Connected for this client"});
    }


    const auth= await getAuthorizedClient(clientId);
    if(!auth){
      return res.status(401).json({ error: "Google authorization failed" });
    }

    const youtubeAnalytics=google.youtubeAnalytics({version:'v2', auth});

    const startDate="2020-10-01"
    const endDate="2025-10-31"

    const response=await youtubeAnalytics.reports.query({
      ids:`channel==${client.googleAccounts.youtubeChannelId}`,
      startDate,
      endDate,
      metrics:"views,likes,comments,estimatedMinutesWatched,subscribersGained,subscribersLost",
      dimensions:'day',
      sort:'day'

    })

    res.json({ success: true, data: response.data });
    
  } catch (error) {
    console.error("Error fetching YouTube Analytics:", error.message);
    res.status(500).json({ error: "Failed to fetch YouTube Analytics data" });
  }
})




// fetch all the campaigns from the google ads

// router.get("/google-ads/campaigns/:clientId", async (req, res) => {
//   try {
//     const { clientId } = req.params;
//     const token = await Token.findOne({ clientId, platform: "Google" });
//     if (!token) return res.status(404).json({ error: "No Google Ads token found" });

//     const client = new GoogleAdsApi({
//       client_id: process.env.GOOGLE_CLIENT_ID,
//       client_secret: process.env.GOOGLE_CLIENT_SECRET,
//       developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
//     });

//     const customer = client.Customer({
//       customer_id: process.env.GOOGLE_LOGIN_CUSTOMER_ID, // 7149545621 (sub-account)
//       refresh_token: token.refresh_token,
//       login_customer_id: process.env.GOOGLE_LOGIN_CUSTOMER_ID,
//     });

//     const query = `
//       SELECT
//         campaign.id,
//         campaign.name,
//         campaign.status,
//         campaign.advertising_channel_type,
//         campaign.start_date,
//         campaign.end_date
//       FROM campaign
//       ORDER BY campaign.id
//     `;

//     const campaigns = await customer.query(query);

//     const formatted = campaigns.map(c => ({
//       id: c.campaign.id,
//       name: c.campaign.name,
//       status: c.campaign.status,
//       type: c.campaign.advertising_channel_type,
//       startDate: c.campaign.start_date,
//       endDate: c.campaign.end_date,
//     }));

//     res.json({ success: true, campaigns: formatted });
//   } catch (error) {
//    console.error("Error fetching campaigns:", JSON.stringify(error, null, 2));

//     res.status(500).json({ error: "Failed to fetch Google Ads campaigns" });
//   }
// });





// fetching the data from the google ads test accounts


router.get("/google-ads/test-campaigns/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    // 1️⃣ Get the token stored for this client
    const token = await Token.findOne({ clientId, platform: "Google" });
    if (!token) return res.status(404).json({ error: "No Google token found for this client" });

    // 2️⃣ Initialize the API client
    const api = new GoogleAdsApi({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN, // test token works here
    });

    // 3️⃣ Choose your test account ID
    // Pick one of the IDs from your dashboard (remove dashes)
    // Example: 9116967788 or 7149545621
    const TEST_CUSTOMER_ID = "7149545621";
    
    // 4️⃣ Build the Ads Customer client
    const customer = api.Customer({
      customer_id: TEST_CUSTOMER_ID,                   // test Ads account
      login_customer_id: process.env.GOOGLE_LOGIN_CUSTOMER_ID, // your MCC
      refresh_token: token.refresh_token,
    });

    // 5️⃣ Define a test query
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date
      FROM campaign
      ORDER BY campaign.id
    `;

    // 6️⃣ Fetch campaigns
    const rows = await customer.query(query);

    // 7️⃣ Format for the frontend
    const campaigns = rows.map(r => ({
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      type: r.campaign.advertising_channel_type,
      startDate: r.campaign.start_date,
      endDate: r.campaign.end_date,
    }));

    res.json({
      success: true,
      accountId: TEST_CUSTOMER_ID,
      campaigns,
    });
  } catch (error) {
    console.error("Error fetching test campaigns:", JSON.stringify(error, null, 2));
    res.status(500).json({ error: "Failed to fetch test campaigns" });
  }
});









// ✅ Fetch performance metrics for a specific Google Ads test account
router.get("/google-ads/test-metrics/:clientId", async (req, res) => {
  try {


  const { clientId } = req.params;

    // Find saved Google token
  const token = await Token.findOne({ clientId, platform: "Google" });
  if (!token) return res.status(404).json({ error: "No Google token found for this client" });

    // Initialize Google Ads API
  
  const api = new GoogleAdsApi({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  const TEST_CUSTOMER_ID = process.env.GOOGLE_TEST_CUSTOMER_ID;

  const customer = api.Customer({
  customer_id: TEST_CUSTOMER_ID,
  login_customer_id: process.env.GOOGLE_LOGIN_CUSTOMER_ID,
  refresh_token: token.refresh_token,
});

    // GAQL Query for metrics (last 7 days)
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        segments.date
      FROM campaign
      WHERE segments.date DURING LAST_7_DAYS
      ORDER BY segments.date DESC
    `;

    const rows = await customer.query(query);

    // Format clean output
    const metrics = rows.map(r => ({
      date: r.segments.date,
      campaignId: r.campaign.id,
      campaignName: r.campaign.name,
      impressions: r.metrics.impressions,
      clicks: r.metrics.clicks,
      ctr: r.metrics.ctr,
      avgCpc: (r.metrics.average_cpc / 1_000_000).toFixed(2),
      cost: (r.metrics.cost_micros / 1_000_000).toFixed(2),
    }));

    res.json({
      success: true,
      accountId: TEST_CUSTOMER_ID,
      metrics,
    });
  } catch (error) {
    console.error("Error fetching Google Ads test metrics:", JSON.stringify(error, null, 2));
    res.status(500).json({ error: "Failed to fetch Google Ads test metrics" });
  }
});











    
























export default router;
