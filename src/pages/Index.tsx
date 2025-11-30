import { CastInterface } from "@/components/CastInterface";
import { Monitor } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const { toast } = useToast();

  const handleCast = async (url: string) => {
    try {
      console.log("Processing URL for casting:", url);
      
      // Call the render-website function to generate a viewer URL
      const { data: renderData, error: renderError } = await supabase.functions.invoke('render-website', {
        body: { url, action: 'viewer' }
      });

      if (renderError) {
        console.error("Error from render function:", renderError);
        toast({
          title: "Rendering Failed",
          description: renderError.message || "Failed to prepare website for casting",
          variant: "destructive",
        });
        return null;
      }

      console.log("Render response:", renderData);
      
      // Return the viewer URL that can be cast
      return renderData.viewerUrl;
      
    } catch (error) {
      console.error("Error processing website:", error);
      toast({
        title: "Processing Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-bg">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-4">
            <Monitor className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            ChromeCast Portal
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Cast any website to your Chromecast from a remote server. Enter a URL and stream it directly to your TV.
          </p>
        </header>

        {/* Main Interface */}
        <main>
          <CastInterface onCast={handleCast} />
        </main>

        {/* Info Cards */}
        <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <div className="p-6 rounded-lg bg-card/50 border border-border/50 backdrop-blur-sm">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
              <span className="text-primary font-bold">1</span>
            </div>
            <h3 className="font-semibold mb-2">Connect Device</h3>
            <p className="text-sm text-muted-foreground">
              Connect to your Chromecast device on the same network
            </p>
          </div>
          <div className="p-6 rounded-lg bg-card/50 border border-border/50 backdrop-blur-sm">
            <div className="h-10 w-10 rounded-lg bg-secondary/20 flex items-center justify-center mb-4">
              <span className="text-secondary font-bold">2</span>
            </div>
            <h3 className="font-semibold mb-2">Enter URL</h3>
            <p className="text-sm text-muted-foreground">
              Paste the website URL you want to cast
            </p>
          </div>
          <div className="p-6 rounded-lg bg-card/50 border border-border/50 backdrop-blur-sm">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-4">
              <span className="text-primary font-bold">3</span>
            </div>
            <h3 className="font-semibold mb-2">Start Casting</h3>
            <p className="text-sm text-muted-foreground">
              Watch the website render in real-time on your TV
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
