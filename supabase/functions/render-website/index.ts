import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, action } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Processing URL for live casting:', url, 'Action:', action);

    // Validate URL
    let targetUrl: URL;
    try {
      targetUrl = new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Use custom Chromecast receiver that can display live websites
    const receiverUrl = `${req.headers.get('origin') || 'https://db36ca02-4c2b-4e0e-a58f-a351aa767ebf.lovableproject.com'}/chromecast-receiver.html`;
    
    // The actual website URL will be passed to the receiver
    // For now, return the target URL directly so the bridge can cast it
    const viewerUrl = url;

    console.log('Using custom Chromecast receiver for live streaming');
    console.log('Target URL:', viewerUrl);
    console.log('Receiver app:', receiverUrl);
    
    return new Response(
      JSON.stringify({ 
        success: true,
        url,
        viewerUrl,
        receiverUrl,
        contentType: 'text/html',
        message: 'Custom receiver enabled for live streaming',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error processing website:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process website',
        message: errorMessage
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
