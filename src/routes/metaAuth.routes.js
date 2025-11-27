import express from "express"
import querystring from "querystring"
import Token from "../models/token.model.js";
import axios from "axios"
import dotenv from "dotenv";
import { sendEmail } from "../utils/email.js";
import Client from "../models/client.model.js";

dotenv.config();

const router = express.Router();

router.get("/auth", async (req, res) => {
    try {
        const { clientId } = req.query;

        if (!clientId) {
            return res.status(400).json({ error: "ClientId is required" });
        }

        const client = await Client.findById(clientId);

        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }

        const state = JSON.stringify({ clientId });

        const params = {
            client_id: process.env.META_APP_ID,
            redirect_uri: process.env.META_REDIRECT_URI,
            scope: [
                "read_insights",
                "pages_show_list",
                "pages_read_engagement",
                "pages_read_user_content",
                "pages_manage_metadata",
                "instagram_basic",
                "instagram_manage_insights",
                "ads_read",
                "business_management"
            ].join(","),
            response_type: "code",
            state
        };

        const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?${querystring.stringify(params)}`;

        await sendEmail(
            client.clientEmail,
            "Connect your Facebook Account to LRB Insights",
            `<p>Hello ${client.clientName},</p>
       <p>Click <a href="${authUrl}" target="_blank">here</a> to securely connect your Facebook account with LRB Insights.</p>
       <p>This allows your analytics data to sync automatically.</p>`
        );

        return res.json({ success: true, message: "Meta Oauth link sent to client email." });

    } catch (error) {
        console.error("Meta Auth Error:", error);
        res.status(500).json({ error: "Failed to generate Meta auth URL" });
    }
})

router.get("/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).json({ error: "Missing code or state" });
        }

        const { clientId } = JSON.parse(state);

        const client = await Client.findById(clientId);
        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }

        // 1. Exchange short-lived token
        const shortRes = await axios.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            {
                params: {
                    client_id: process.env.META_APP_ID,
                    client_secret: process.env.META_APP_SECRET,
                    redirect_uri: process.env.META_REDIRECT_URI,
                    code
                }
            }
        );

        const shortToken = shortRes.data.access_token;

        // 2. Exchange long-lived token
        const longRes = await axios.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            {
                params: {
                    grant_type: "fb_exchange_token",
                    client_id: process.env.META_APP_ID,
                    client_secret: process.env.META_APP_SECRET,
                    fb_exchange_token: shortToken
                }
            }
        );

        const longToken = longRes.data.access_token;
        const expiresIn = longRes.data.expires_in;

        // 3. Fetch Facebook Pages
        const pagesRes = await axios.get(
            "https://graph.facebook.com/v21.0/me/accounts",
            { params: { access_token: longToken } }
        );

        const pages = pagesRes.data.data || [];
        const finalPages = [];

        // 4. For each FB Page, fetch IG Business ID
        for (const p of pages) {
            let instagramBusinessId = null;

            try {
                const igRes = await axios.get(
                    `https://graph.facebook.com/v21.0/${p.id}`,
                    {
                        params: {
                            fields: "instagram_business_account",
                            access_token: p.access_token
                        }
                    }
                );

                instagramBusinessId =
                    igRes.data.instagram_business_account?.id || null;

            } catch (err) {
                console.log("IG fetch error for page:", p.id);
            }

            finalPages.push({
                pageId: p.id,
                pageName: p.name,
                pageAccessToken: p.access_token,
                instagramBusinessId
            });
        }

        // 5. Merge everything into client document cleanly
        client.metaAccounts = {
            userAccessToken: longToken,
            userAccessTokenExpiresIn: expiresIn,
            tokenCreatedAt: new Date(),
            pages: finalPages,
            selectedPageId: client.metaAccounts?.selectedPageId || null
        };

        // update platformConnections
        client.platformConnections = [
            ...client.platformConnections.filter(c => c.name !== "Meta"),
            {
                name: "Meta",
                status: "Connected",
                connectedAt: new Date()
            }
        ];

        await client.save();

        // 6. Success HTML response
        res.send(`
            <h2>✅ Meta account connected successfully!</h2>
            <p>You can close this window and return to the LRB Insights dashboard.</p>
        `);

    } catch (error) {
        console.error("Meta callback error:", error.response?.data || error.message);
        return res.status(500).send("Meta authentication failed");
    }
});

// Select pages
router.post("/select-page", async (req, res) => {
    try {
        const { clientId, pageId } = req.body;

        if (!clientId || !pageId) {
            return res.status(400).json({ error: "ClientId and PageId Required" });
        }

        const client = await Client.findById(clientId);
        if (!client) {
            return res.status(404).json({ error: "Client Not Found" });
        }

        const found = client.metaAccounts.pages.find(p => p.pageId === pageId);

        if (!found) {
            return res.status(400).json({ error: "Page Not Found in Client Account" });
        }

        client.metaAccounts.selectedPageId = pageId;

        await client.save();

        res.json({
            success: true,
            message: "Page Selected Successfully",
            selectedPageId: pageId,
            instagramBusinessId: found.instagramBusinessId
        });

    } catch (error) {
        console.error("Select Page error:", error.message);
        res.status(500).json({ error: "Failed to select page" });
    }
})

// TEST ENDPOINT - Try metrics one at a time to find what works
router.get("/test-metrics/:clientId", async (req, res) => {
    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) {
            return res.status(404).json({ error: "Client Not Found" });
        }

        const page = client.metaAccounts.pages.find(
            (p) => p.pageId === client.metaAccounts.selectedPageId
        );

        if (!page) {
            return res.status(400).json({ error: "No Page Selected" });
        }

        // Allow ?period=day|week|lifetime
        const period = req.query.period || "day";

        // Metrics you want to test
       const metricsToTest = [
  // Views & Impressions

  'page_views_total',
  'page_impressions_unique',
  'page_post_engagements',
  'page_daily_follows',
  'page_daily_unfollows',
  'page_video_views',
  'page_video_repeat_views',
  'page_video_complete_views_30s',
  'page_video_view_time',
  'page_total_actions'

];


        const results = {};
        const workingMetricsOnly=[]

        for (const metric of metricsToTest) {
            try {
                const response = await axios.get(
                    `https://graph.facebook.com/v21.0/${page.pageId}/insights`,
                    {
                        params: {
                            metric,
                            period,
                            access_token: page.pageAccessToken
                        }
                    }
                );

                results[metric] = {
                    status: "WORKS",
                    values: response.data?.data || [],
                    
                    raw: response.data
                };

                workingMetricsOnly.push(metric)

            } catch (error) {
                const metaError = error.response?.data?.error;

                results[metric] = {
                    status: "FAILED",
                    error: metaError?.message || error.message,
                    code: metaError?.code || null,
                    type: metaError?.type || null
                };
            }
        }


        console.log(results)

        console.log(workingMetricsOnly)

        return res.json({
            success: true,
            testingPeriod: period,
            pageId: page.pageId,
            pageName: page.pageName,
            metricsCount: metricsToTest.length,
            results
        });

    } catch (error) {
        console.error("Test metrics route error:", error.message);
        return res.status(500).json({
            error: "Internal Server Error",
            details: error.message
        });
    }
});


// Get basic page info (no insights needed)
router.get("/page-info/:clientId", async (req, res) => {
    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) return res.status(404).json({ error: "Client Not Found" });

        const page = client.metaAccounts.pages.find(
            (p) => p.pageId === client.metaAccounts.selectedPageId
        );

        if (!page) {
            return res.status(400).json({ error: "No Page Selected" });
        }




        // Get basic page info - this should ALWAYS work
        const pageInfo = await axios.get(
            `https://graph.facebook.com/v21.0/${page.pageId}`,
            {
                params: {
                    fields: "id,name,fan_count,followers_count,category",
                    access_token: page.pageAccessToken
                }
            }
        );

        console.log(pageInfo.data)

        return res.json({
            success: true,
            page: pageInfo.data
        });

    } catch (error) {
        console.error("Page info error:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: "Failed to fetch page info",
            details: error.response?.data || error.message
        });
    }
});

// UPDATED: Working Page Insights endpoint
router.get("/page-insights/:clientId", async (req, res) => {
    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) return res.status(404).json({ error: "Client Not Found" });

        const page = client.metaAccounts.pages.find(
            (p) => p.pageId === client.metaAccounts.selectedPageId
        );

        if (!page) {
            return res.status(400).json({ error: "No Page Selected" });
        }

        // IMPORTANT: Use alternative method - get insights via fields parameter
        // This is more reliable than the /insights endpoint



        const response = await axios.get(
            `https://graph.facebook.com/v21.0/${page.pageId}`,
            {
                params: {
                    fields: "insights.metric(page_views_total,page_impressions_unique,page_post_engagements,page_daily_follows,page_video_views,page_video_repeat_views,page_video_complete_views_30s,page_video_view_time,page_total_actions)",
                    access_token: page.pageAccessToken
                }
            }
        );

        console.log("Insights fetched successfully:", response.data);

        return res.json({ 
            success: true, 
            data: response.data,
            pageId: page.pageId,
            pageName: page.pageName
        });

    } catch (error) {
        console.error("Page insights error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });

        return res.status(error.response?.status || 500).json({ 
            error: "Failed to fetch page insights",
            details: error.response?.data || error.message,
            hint: "Try the /test-metrics endpoint to see which metrics are available"
        });
    }
});








// function normalizeIgInsight(responseData) {
//     if (!responseData || !Array.isArray(responseData.data)) return 0;

//     const metricObj = responseData.data[0];
//     if (!metricObj) return 0;

//     // If total_value exists
//     if (metricObj.total_value) {
//         if (typeof metricObj.total_value.value === "number") {
//             return metricObj.total_value.value;
//         }
//     }

//     // If time-series format
//     if (metricObj.values && Array.isArray(metricObj.values)) {
//         if (metricObj.values.length === 0) return 0;

//         const first = metricObj.values[0];
//         if (first?.value !== undefined) return first.value;
//     }

//     // Meta gave you air
//     return 0;
// }



// testing which metrics works for instagram


router.get("/instagram-test-metrics/:clientId", async (req, res) => {

    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) {
            return res.status(404).json({ error: "Client Not Found" });
        }

        const page = client.metaAccounts.pages.find(
            p => p.pageId === client.metaAccounts.selectedPageId
        );

        if (!page) {
            return res.status(400).json({ error: "No Page Selected" });
        }

        console.log(page)

        // Make sure we have IG business account
        const igUserId = page.instagramBusinessId;
        if (!igUserId) {
            return res.status(400).json({
                error: "No Instagram Business Account Linked to this Page"
            });
        }

        const access_token = page.pageAccessToken;
        const period = req.query.period || "day";

        // Instagram account insights to test
        const metricsToTest = [
            "reach",
         
            "follower_count",
            'accounts_engaged',
            'comments',
            'engaged_audience_demographics',
            'follows_and_unfollows',
            'likes',
            'shares',
            'views',







            
        ];

        const results = {};
        const workingMetricsOnly=[];

        for (const metric of metricsToTest) {
            try {
                const response = await axios.get(
                    `https://graph.facebook.com/v24.0/${igUserId}/insights`,
                    {
                        params: {
                            metric,
                            period,
                            access_token
                        }
                    }
                );

                results[metric] = {
                    status: "WORKS",
                    value: normalizeIgInsight(response.data),
                    raw: response.data
                };

                workingMetricsOnly.push(metric);

            } catch (error) {
                const metaError = error.response?.data?.error;

                results[metric] = {
                    status: "FAILED",
                    error: metaError?.message || error.message,
                    code: metaError?.code || null,
                    type: metaError?.type || null
                };
            }
        }

        console.log(workingMetricsOnly)

        return res.json({
            success: true,
            testingPeriod: period,
            instagramUserId: igUserId,
            metricsTested: metricsToTest.length,
            results
        });

    } catch (error) {
        console.error("Instagram Test Metrics Error:", error.message);
        console.log(error);
        return res.status(500).json({
            error: "Internal Server Error",
            details: error.message
        });
    }
});



// Instagram Insights - Updated version
router.get("/instagram-insights/:clientId", async (req, res) => {
    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) return res.status(404).json({ error: "Client not found" });

        const page = client.metaAccounts.pages.find(
            (p) => p.pageId === client.metaAccounts.selectedPageId
        );

        if (!page) return res.status(400).json({ error: "No page selected" });
        if (!page.instagramBusinessId)
            return res.status(400).json({ error: "Instagram not linked to selected page" });

        const igId = page.instagramBusinessId;
        const access_token = page.pageAccessToken;

        // ------------------------------------------------------------
        // 1. Fetch Instagram Account Basic Info
        // ------------------------------------------------------------
        const accountInfoRes = await axios.get(
            `https://graph.facebook.com/v21.0/${igId}`,
            {
                params: {
                    fields: "followers_count,follows_count,media_count,username,profile_picture_url",
                    access_token
                }
            }
        );

        const accountInfo = accountInfoRes.data;


        // ------------------------------------------------------------
        // 2. Prepare metrics (Instagram API has strict rules)
        // ------------------------------------------------------------

        // Group A — time_series metrics (NO metric_type required)
        const timeSeriesMetrics = [
            "reach",
            "follower_count"
        ].join(",");

        // Group B — total_value-only metrics (REQUIRE metric_type=total_value)
        const totalValueMetrics = [
            "accounts_engaged",
            "total_interactions",
            "views"
        ].join(",");


        // Normalizer (Meta returns empty instead of 0)
        const normalizeInsight = metricObj => {
            if (!metricObj) return 0;

            // For time_series
            if (metricObj.values && metricObj.values.length > 0) {
                return metricObj.values[0].value ?? 0;
            }

            // For total_value
            if (metricObj.total_value && typeof metricObj.total_value.value === "number") {
                return metricObj.total_value.value;
            }

            return 0;
        };


        // ------------------------------------------------------------
        // 3. Fetch Insights — Instagram REQUIRES two API calls
        // ------------------------------------------------------------
        const insights = {
            reach: 0,
            follower_count: 0,
            accounts_engaged: 0,
            total_interactions: 0,
            views: 0
        };

        // ----- Time Series Metrics -----
        try {
            const timeSeriesRes = await axios.get(
                `https://graph.facebook.com/v21.0/${igId}/insights`,
                {
                    params: {
                        metric: timeSeriesMetrics,
                        period: "day",
                        access_token
                    }
                }
            );

            timeSeriesRes.data?.data?.forEach(m => {
                insights[m.name] = normalizeInsight(m);
            });

        } catch (err) {
            console.log("IG time series fetch failed:", err.response?.data);
        }


        // ----- Total Value Metrics -----
        try {
            const totalValueRes = await axios.get(
                `https://graph.facebook.com/v21.0/${igId}/insights`,
                {
                    params: {
                        metric: totalValueMetrics,
                        metric_type: "total_value",
                        period: "day",
                        access_token
                    }
                }
            );

            totalValueRes.data?.data?.forEach(m => {
                insights[m.name] = normalizeInsight(m);
            });

        } catch (err) {
            console.log("IG total value fetch failed:", err.response?.data);
        }

        // ------------------------------------------------------------
        // 4. Return final unified response
        // ------------------------------------------------------------

        console.log("accountInfo", accountInfo)
        console.log("insights", insights)
        return res.json({
            success: true,
            data: {
                accountInfo,
                insights
            }
        });

    } catch (err) {
        console.error("Instagram Insights Error:", err.response?.data || err.message);
        return res.status(500).json({
            error: "Failed to fetch Instagram insights",
            details: err.response?.data || err.message
        });
    }
});


router.get("/instagram-followers-daily/:clientId", async (req, res) => {
    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) return res.status(404).json({ error: "Client not found" });

        const page = client.metaAccounts.pages.find(
            p => p.pageId === client.metaAccounts.selectedPageId
        );

        if (!page) return res.status(400).json({ error: "No page selected" });
        if (!page.instagramBusinessId)
            return res.status(400).json({ error: "No Instagram linked" });

        const igId = page.instagramBusinessId;
        const token = page.pageAccessToken;

        const response = await axios.get(
            `https://graph.facebook.com/v21.0/${igId}/insights`,
            {
                params: {
                    metric: "follower_count",
                    period: "day",
                    access_token: token
                }
            }
        );

        const data = response.data?.data?.[0]?.values || [];

        // Clean normalization
        const dailyFollowers = data.map(item => ({
            date: item.end_time,
            followers: item.value
        }));

        return res.json({
            success: true,
            igId,
            days: dailyFollowers.length,
            dailyFollowers
        });

    } catch (error) {
        console.log(error.response?.data || error.message);
        return res.status(500).json({
            error: "Failed to fetch follower trend",
            details: error.response?.data || error.message
        });
    }
});


const postMetrics = [
  "post_impressions_unique",
  "post_clicks",
  "post_reactions_like_total",
  "post_reactions_love_total",
  "post_reactions_wow_total",
  "post_reactions_haha_total",
  "post_reactions_sorry_total",
  "post_reactions_anger_total",
];




async function fetchPostInsights(postId, token) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v21.0/${postId}/insights`,
            {
                params: { metric: postMetrics.join(","), period:'lifetime', access_token: token }
            }
        );

        const insights = {};
        res.data.data.forEach(metric => {
            insights[metric.name] = metric.values?.[0]?.value ?? 0;
        });

        return insights;

    } catch (err) {
        return { error: true, details: err.response?.data };
    }
}









router.get("/test-post-metrics/", async (req, res) => {
  const  postId  = "893725637154043_122096213931131168";
  console.log("postid",postId)
  const token = 'EAATcgLXYDZAsBP80uuwmgaH6zJhPD8BtgR5ss0AufthVakUdMDBypLCsTI8cotqw0VZAMK8uaKZBZA1K3DLI56YWP6mlmCudJf1xosfFgI1BkPS87D6KAtkrKo16nkZAe5iJCw7EZCIfEnjmuDKEtBC9C7KftcLaKXnhdTHNB4zF1yvZBRLsQMZCXk3jdWtGK50rOLI5'
  // or however you're storing it

  const results = [];

  for (const metric of postMetrics) {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v21.0/${postId}/insights`,
        {
          params: {
            metric,
            period: "lifetime",
            access_token: token
          }
        }
      );

      console.log("metrics:", metric)

      results.push({
        metric,
        success: true,
        data: response.data
      });

      console.log("metrics", metric)

    } catch (error) {
      results.push({
        metric,
        success: false,
        error: error.response?.data || error.message
      });
    }
  }

  res.json(results);
});





async function fetchAllFacebookPosts(pageId, access_token) {
    let posts = [];
    let nextUrl = `https://graph.facebook.com/v21.0/${pageId}/posts?fields=id,message,created_time,full_picture&limit=100&access_token=${access_token}`;

    while (nextUrl) {
        const res = await axios.get(nextUrl);
        posts.push(...(res.data.data || []));
        nextUrl = res.data?.paging?.next || null;
    }

    return posts;
}







router.get("/facebook-posts-with-insights/:clientId", async (req, res) => {
    try {
        const client = await Client.findById(req.params.clientId);
        if (!client) return res.status(404).json({ error: "Client Not Found" });

        const page = client.metaAccounts.pages.find(
            p => p.pageId === client.metaAccounts.selectedPageId
        );
        if (!page) return res.status(400).json({ error: "No Page Selected" });

        const token = page.pageAccessToken;

        // 1. All posts
        const posts = await fetchAllFacebookPosts(page.pageId, token);

        // 2. Add insights
        const results = [];
        for (const post of posts) {
            try {
                 const insights = await fetchPostInsights(post.id, token);
            results.push({ ...post, insights });
            } catch (error) {
                results.push({ 
        ...post, 
        insights: { error: true, details: error.response?.data || error.message }
    });
            }
           
        }

        posts.forEach(post => {
  if (post.insights?.error) {
    console.log("Error details:", JSON.stringify(post.insights.details, null, 2));
  }
});




        res.json({
            success: true,
            totalPosts: results.length,
            posts: results
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Failed", details: err.message });
    }
});






router.get("/meta-ad-accounts/:clientId", async(req,res)=>{
    try {

        const client=await Client.findById(req.params.clientId);
        if (!client) return res.status(404).json({ error: "Client Not Found" });

        const page = client.metaAccounts.pages.find(
      (p) => p.pageId === client.metaAccounts.selectedPageId
    );

    if (!page) return res.status(400).json({ error: "No Page Selected" });

    const token = client.metaAccounts.userAccessToken;


    const response = await axios.get(
      `https://graph.facebook.com/v21.0/me/adaccounts`,
      {
        params: {
          fields: "id,account_id,name,account_status",
          access_token: token
        }
      }
    );
    
    console.log("adaccounts ",response.data.data)

    return res.json({
      success: true,
      adAccounts: response.data.adaccounts?.data || []
    });
  
    } catch (error) {

        console.log(error.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to fetch ad accounts",
      details: error.response?.data || error.message
    });
        
    }
});



// =======================================================================================================

// fake datas

const mockCampaigns = [
  {
    id: "238500100001",
    name: "Winter Promo Campaign",
    status: "PAUSED",
    objective: "TRAFFIC",
    effective_status: "PAUSED"
  },
  {
    id: "238500100002",
    name: "Brand Awareness Boost",
    status: "ACTIVE",
    objective: "AWARENESS",
    effective_status: "ACTIVE"
  }
];

const mockAdSets = {
  "238500100001": [
    {
      id: "7001",
      name: "Canada Audience",
      status: "ACTIVE",
      daily_budget: 300,
      start_time: "2025-11-22"
    },
    {
      id: "7002",
      name: "US Broad Audience",
      status: "PAUSED",
      daily_budget: 200,
      start_time: "2025-11-10"
    }
  ],

  "238500100002": [
    {
      id: "7003",
      name: "18-34 Age Group",
      status: "ACTIVE",
      daily_budget: 500,
      start_time: "2025-11-01"
    }
  ]
};


const mockAds = {
  "7001": [
    {
      id: "ad_001",
      name: "Winter Creative 1",
      status: "ACTIVE",
      creative_type: "IMAGE",
      thumbnail: "https://via.placeholder.com/200"
    },
    {
      id: "ad_002",
      name: "Winter Creative 2",
      status: "PAUSED",
      creative_type: "VIDEO",
      thumbnail: "https://via.placeholder.com/200"
    }
  ],

  "7002": [
    {
      id: "ad_003",
      name: "US Market Creative",
      status: "ACTIVE",
      creative_type: "IMAGE",
      thumbnail: "https://via.placeholder.com/200"
    }
  ],

  "7003": [
    {
      id: "ad_004",
      name: "Brand Boost Ad",
      status: "ACTIVE",
      creative_type: "IMAGE",
      thumbnail: "https://via.placeholder.com/200"
    }
  ]
};



const mockAdInsights = {
  "ad_001": {
    impressions: 12000,
    reach: 9000,
    clicks: 420,
    spend: 45.20,
    cpc: 0.11,
    ctr: 3.5,
    conversions: 12
  },

  "ad_002": {
    impressions: 8000,
    reach: 6000,
    clicks: 180,
    spend: 20.10,
    cpc: 0.11,
    ctr: 2.2,
    conversions: 6
  },

  "ad_003": {
    impressions: 5000,
    reach: 4000,
    clicks: 140,
    spend: 18.60,
    cpc: 0.13,
    ctr: 2.8,
    conversions: 3
  },

  "ad_004": {
    impressions: 15000,
    reach: 11000,
    clicks: 600,
    spend: 65.00,
    cpc: 0.10,
    ctr: 4.0,
    conversions: 22
  }
};










// =======================================================================================================



router.get("/meta-campaigns/:clientId/", async (req, res) => {

    console.log("meta-campaigns reached");
  try {
    const { clientId} = req.params;

    const adAccountId='act_445418002927999'



    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client Not Found" });

    const token = client.metaAccounts.userAccessToken;
    if (!token) return res.status(400).json({ error: "Meta Not Connected" });

    const response = await axios.get(
      `https://graph.facebook.com/v21.0/${adAccountId}/campaigns`,
      {
        params: {
          fields: "id,name,status,objective,effective_status",
          access_token: token,
        },
      }
    );

    const campaigns= response.data.data?.length ? response.data.data : mockCampaigns;

    console.log("campaigns", campaigns);

    return res.json({ success: true, campaigns });

  } catch (error) {
    console.error("Campaign error:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to fetch campaigns",
      details: error.response?.data || error.message,
    });
  }
});


router.get("/meta-adsets/:clientId/:campaignId", async (req, res) => {
  try {
    const { clientId, campaignId } = req.params;

    console.log("campaignID", campaignId)
    console.log("clientID", clientId)

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client Not Found" });

    const token = client.metaAccounts.userAccessToken;

    // const response = await axios.get(
    //   `https://graph.facebook.com/v21.0/${campaignId}/adsets`,
    //   {
    //     params: {
    //       fields: "id,name,status,daily_budget,start_time,effective_status",
    //       access_token: token,
    //     },
    //   }
    // );

    const adSets = mockAdSets[campaignId] || [];

    console.log("adsets", adSets);

    return res.json({
      success: true,
      adSets,
    });

  } catch (error) {
    console.log("Adset error:", error.response?.data || error.message);
  }
});



router.get("/meta-ads/:clientId/:adSetId", async (req, res) => {
  try {
    const { clientId, adSetId } = req.params;

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client Not Found" });

    const token = client.metaAccounts.userAccessToken;

    // const response = await axios.get(
    //   `https://graph.facebook.com/v21.0/${adSetId}/ads`,
    //   {
    //     params: {
    //       fields: "id,name,status,creative,configured_status,effective_status",
    //       access_token: token,
    //     },
    //   }
    // );

    const ads = mockAds[adSetId] || [];

    console.log("ads", ads)

    return res.json({
      success: true,
      ads,
    });

  } catch (error) {
    console.log("Ads error:", error.response?.data || error.message);

    // Fake fallback
    return res.json({
      success: true,
      ads: [
        {
          id: "fake_ad_1",
          name: "Test Ad (Fallback)",
          status: "PAUSED",
          creative: {
            thumbnail_url: "https://via.placeholder.com/200"
          }
        }
      ],
    });
  }
});




router.get("/meta-ad-insights/:clientId/:adId", async (req, res) => {
  try {
    const { clientId, adId } = req.params;

    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client Not Found" });

    const token = client.metaAccounts.userAccessToken;

    // const response = await axios.get(
    //   `https://graph.facebook.com/v21.0/${adId}/insights`,
    //   {
    //     params: {
    //       fields: "impressions,reach,clicks,spend,cpc,ctr,actions",
    //       access_token: token,
    //     },
    //   }
    // );

    const insights= mockAdInsights[adId] || [];

    console.log("Insights", insights)

    return res.json({
      success: true,
      insights: insights
    });

  } catch (error) {
    console.log("Insights error:", error.response?.data || error.message);

    // return res.json({
    //   success: true,
    //   insights: {
    //     impressions: 12000,
    //     reach: 9000,
    //     clicks: 420,
    //     spend: 45.20,
    //     cpc: 0.11,
    //     ctr: 3.5,
    //     actions: [{ action_type: "link_click", value: 420 }]
    //   }
    // });
  }
});













router.post("/disconnect", async (req, res) => {
    try {
        const { clientId } = req.body;

        const client = await Client.findById(clientId);

        if (!client) return res.status(404).json({ error: "Client not found" });

        const userToken = client.metaAccounts?.userAccessToken;

        if (userToken) {
            try {
                const userInfo = await axios.get(
                    "https://graph.facebook.com/v21.0/me",
                    {
                        params: {
                            access_token: userToken
                        }
                    }
                );

                const userId = userInfo.data.id;

                await axios.delete(
                    `https://graph.facebook.com/v21.0/${userId}/permissions`,
                    {
                        params: { access_token: userToken }
                    }
                );
            } catch (err) {
                console.log("Token revocation failed (may already be invalid):", err.message);
            }
        }

        client.metaAccounts = {
            userAccessToken: null,
            userAccessTokenExpiresIn: null,
            tokenCreatedAt: null,
            pages: [],
            selectedPageId: null,
        }

        client.platformConnections = client.platformConnections.filter(
            (conn) => conn.name !== "Meta"
        );

        client.platformConnections.push({
            name: "Meta",
            status: "Not Connected",
            connectedAt: null,
        });

        await client.save();

        res.json({ success: true, message: "Meta disconnected successfully." });

    } catch (error) {
        console.error("Meta disconnect error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to disconnect Meta" });
    }
})

export default router