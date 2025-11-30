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

    console.log('Processing URL for casting:', url, 'Action:', action);

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

    // Generate a viewer URL that Chromecast can load
    // This creates a special page that displays the website in an iframe
    const viewerUrl = `${req.headers.get('origin') || 'https://db36ca02-4c2b-4e0e-a58f-a351aa767ebf.lovableproject.com'}/viewer?url=${encodeURIComponent(url)}`;

    console.log('Generated viewer URL:', viewerUrl);

    // For screenshot action, use a screenshot service
    if (action === 'screenshot') {
      // Use a free screenshot API service
      const screenshotUrl = `https://api.screenshotmachine.com?key=demo&url=${encodeURIComponent(url)}&dimension=1920x1080`;
      
      return new Response(
        JSON.stringify({ 
          success: true,
          url,
          viewerUrl,
          screenshotUrl,
          contentType: 'image/png',
          timestamp: new Date().toISOString()
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // For video action, create a video recording of the website
    if (action === 'video') {
      // Use urlbox.io API for video recording
      const apiKey = Deno.env.get('URLBOX_API_KEY');
      const apiSecret = Deno.env.get('URLBOX_API_SECRET');
      
      if (!apiKey || !apiSecret) {
        return new Response(
          JSON.stringify({ 
            error: 'Video recording requires URLBOX_API_KEY and URLBOX_API_SECRET to be configured',
            message: 'Please add your Urlbox.io API credentials to use video recording'
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // Generate HMAC for urlbox request
      const encoder = new TextEncoder();
      const queryString = `url=${encodeURIComponent(url)}&format=mp4&width=1920&height=1080&video=true&video_duration=10`;
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(queryString)
      );
      const token = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const videoUrl = `https://api.urlbox.io/v1/${apiKey}/${token}/mp4?${queryString}`;
      
      console.log('Generated video URL for:', url);
      
      return new Response(
        JSON.stringify({ 
          success: true,
          url,
          viewerUrl,
          videoUrl,
          contentType: 'video/mp4',
          timestamp: new Date().toISOString()
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Default: return viewer URL for casting
    return new Response(
      JSON.stringify({ 
        success: true,
        url,
        viewerUrl,
        contentType: 'text/html',
        message: 'Viewer URL generated for casting',
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
