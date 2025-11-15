import express from "express"
import querystring from "querystring"
import Token from "../models/token.model.js";
import axios from "axios"


import dotenv from "dotenv";
import { sendEmail } from "../utils/email.js";
import Client from "../models/client.model.js";


dotenv.config();

const router=express.Router();

router.get("/auth", async(req,res)=>{
    try {
        const {clientId}=req.query;

        if(!clientId){
            return res.status(400).json({error:"ClientId is required"});
        }

        // check if client exists

        const client=await Client.findById(clientId);

        if(!client){
            return res.status(404).json({error:"Client not found"});

        }

        const state= JSON.stringify({clientId});


        const params={
            client_id: process.env.META_APP_ID,
            redirect_uri:process.env.META_REDIRECT_URI,
            scope:[
                "ads_read",
                "pages_show_list",
                "pages_read_engagement",
                "pages_read_user_content",
                "read_insights",
                "instagram_basic",
                "instagram_manage_insights"  
            ].join(","),
            response_type:"code",
            state

        };

        const authUrl=`https://www.facebook.com/v21.0/dialog/oauth?${querystring.stringify(params)}`;


        await sendEmail(
            client.clientEmail,
            "Connect your Facebook Account to LRB Insights",
              `<p>Hello ${client.clientName},</p>
       <p>Click <a href="${authUrl}" target="_blank">here</a> to securely connect your Facebook account with LRB Insights.</p>
       <p>This allows your analytics data to sync automatically.</p>`

            
        );



    return res.json({success: true, message: "Meta Oauth link send to client email."});

    } catch (error) {

        console.error("Meta Auth Error:", error);
    res.status(500).json({ error: "Failed to generate Meta auth URL" });
        
    }
})




router.get("/callback", async(req,res)=>{
    try {

        const {code, state}=req.query;

        if(!code || !state){
            return res.status(400).json({error:"Missing code or state"});
        }

        const { clientId }= JSON.parse(state);

        // exchange code for short lived access token

        const tokenRes=await axios.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",{
                params:{
                    client_id:process.env.META_APP_ID,
                    client_secret:process.env.META_APP_SECRET,
                    redirect_uri:process.env.META_REDIRECT_URI,
                    code
                },
            }
        );

        const token=tokenRes.data.access_token;



        // Exchange short lived to long lived token

        const longtokenRes=await axios.get(
           "https://graph.facebook.com/v21.0/oauth/access_token",
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: token,
        },
      }
    );

    const longtoken=longtokenRes.data.access_token;
    const expiresIn=longtokenRes.data.expires_in;


    // save it in database

    await Token.findOneAndUpdate(
      { clientId, platform: "Meta" },
      {
        clientId,
        platform: "Meta",
        access_token: longtoken,
        expires_in: expiresIn,
        connectedAt: new Date()
      },
      { upsert: true, new: true }
    );


    const client = await Client.findById(clientId);


    client.platformConnections=client.platformConnections || [];

    const existingConnection=client.platformConnections.find(conn=> conn.name === "Meta");

    if(existingConnection){
        existingConnection.status = "Connected";
        existingConnection.connectedAt = new Date();
    }else{
        client.platformConnections.push({
            name:"Meta",
            status:"Connected",
            connectedAt: new Date()
        });
    }

    await client.save();

     res.send(`
      <h2>✅ Meta account connected successfully!</h2>
      <p>You can close this window and return to the LRB Insights dashboard.</p>
    `);
        
    } catch (error) {

        console.error("Meta callback error:", error.response?.data || error.message);
    return res.status(500).send("Meta authentication failed");
        
    }
})


export default router
