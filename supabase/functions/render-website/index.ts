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
      
      console.log('Checking Urlbox credentials - API Key exists:', !!apiKey, 'API Secret exists:', !!apiSecret);
      
      if (!apiKey || !apiSecret) {
        console.error('Missing Urlbox credentials');
        // Fallback to viewer URL if video rendering is not configured
        console.log('Falling back to viewer URL');
        return new Response(
          JSON.stringify({ 
            success: true,
            url,
            viewerUrl,
            contentType: 'text/html',
            message: 'Video recording not configured, using viewer URL instead',
            timestamp: new Date().toISOString()
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      try {
        console.log('Requesting video render for:', url);

        // Use urlbox.io render API for synchronous video generation
        const renderResponse = await fetch('https://api.urlbox.com/v1/render/sync', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: url,
            format: 'mp4',
            video: true,
            video_duration: 30,
            width: 1920,
            height: 1080,
            wait_for: 'navigation'
          })
        });

        console.log('Urlbox API response status:', renderResponse.status);

        if (!renderResponse.ok) {
          const errorText = await renderResponse.text();
          console.error('Urlbox API error:', renderResponse.status, errorText);
          
          // Fallback to viewer URL on error
          console.log('Video rendering failed, falling back to viewer URL');
          return new Response(
            JSON.stringify({ 
              success: true,
              url,
              viewerUrl,
              contentType: 'text/html',
              message: 'Video rendering failed, using viewer URL instead',
              timestamp: new Date().toISOString()
            }),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        const renderData = await renderResponse.json();
        console.log('Urlbox render response:', JSON.stringify(renderData));
        const videoUrl = renderData.renderUrl;
        
        if (!videoUrl) {
          console.error('No video URL in response:', renderData);
          // Fallback to viewer URL
          return new Response(
            JSON.stringify({ 
              success: true,
              url,
              viewerUrl,
              contentType: 'text/html',
              message: 'Video URL not available, using viewer URL instead',
              timestamp: new Date().toISOString()
            }),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        console.log('Video ready at:', videoUrl);
        
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
      } catch (videoError) {
        console.error('Error during video rendering:', videoError);
        // Fallback to viewer URL
        return new Response(
          JSON.stringify({ 
            success: true,
            url,
            viewerUrl,
            contentType: 'text/html',
            message: 'Video rendering error, using viewer URL instead',
            timestamp: new Date().toISOString()
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
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
