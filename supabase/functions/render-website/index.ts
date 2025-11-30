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

    console.log('Processing URL for video rendering:', url, 'Action:', action);

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

    // Get Urlbox credentials
    const urlboxApiKey = Deno.env.get('URLBOX_API_KEY');
    const urlboxApiSecret = Deno.env.get('URLBOX_API_SECRET');

    if (!urlboxApiKey || !urlboxApiSecret) {
      console.error('Urlbox credentials not configured');
      return new Response(
        JSON.stringify({ error: 'Video rendering service not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Configure Urlbox to render the website as a video
    const urlboxOptions = {
      url: url,
      format: 'mp4',  // MP4 video format for Chromecast
      video: true,
      video_duration: 30, // 30 seconds of video capture
      full_page: true,
      width: 1920,
      height: 1080,
      quality: 80,
      ttl: 3600 // Cache for 1 hour
    };

    // Create query string
    const queryString = new URLSearchParams(urlboxOptions as any).toString();
    
    // Generate HMAC signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(urlboxApiSecret),
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

    // Construct Urlbox video URL
    const videoUrl = `https://api.urlbox.io/v1/${urlboxApiKey}/${token}/mp4?${queryString}`;

    console.log('Generated video URL via Urlbox');
    console.log('Video will render website as MP4 stream');
    
    return new Response(
      JSON.stringify({ 
        success: true,
        url,
        viewerUrl: videoUrl,
        contentType: 'video/mp4',
        message: 'Server-side video rendering enabled',
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
