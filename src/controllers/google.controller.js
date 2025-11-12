import { google } from "googleapis";
import { getAuthorizedClient } from "../routes/googleAuth.routes";



export async function fetchGA4Properties(clientId){
    const auth = await getAuthorizedClient(clientId);

    const admin= google.analyticsadmin({version: 'v1beta', auth});

    const accountsResponse= await admin.accounts.list();

    const account = accountsResponse.data.accounts?.[0];

    if(!account){
        return res.status(404).json({error: "No GA4 account found"});
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
  const auth = await getAuthorizedClient(clientId);
  const ads = google.googleads({ version: "v15", auth });

  const response = await ads.customers.listAccessibleCustomers();
  const customerResourceNames = response.data.resourceNames || [];

  return customerResourceNames.map((r) => r.replace("customers/", ""));
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




