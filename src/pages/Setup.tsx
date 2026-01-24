import { ArrowLeft, Terminal, Settings, Monitor, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const Setup = () => {
  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link 
          to="/" 
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Tillbaka
        </Link>

        <div>
          <h1 className="text-2xl font-bold">Installationsguide</h1>
          <p className="text-muted-foreground">Sätt upp Chromecast-screensaver i ett nytt hem</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Förutsättningar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>En dator (Windows/Mac/Linux) som alltid är igång på samma nätverk som Chromecast</li>
              <li>Node.js 18 eller högre installerat</li>
              <li>En Chromecast-enhet på nätverket</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steg 1: Klona projektet</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
              <code>{`git clone <repository-url>
cd <project-folder>`}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steg 2: Konfigurera bridge-tjänsten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Gå till bridge-mappen och installera:</p>
              <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                <code>{`cd bridge
npm install
cp .env.example .env`}</code>
              </pre>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">Redigera <code className="bg-muted px-1 rounded">.env</code> med dina uppgifter:</p>
              <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                <code>{`SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=<din-anon-key>
DEVICE_ID=mitt-hem
POLL_INTERVAL=5000`}</code>
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                💡 Använd ett unikt DEVICE_ID för varje hem (t.ex. stockholm, goteborg)
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Steg 3: Starta bridge-tjänsten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
              <code>node index.js</code>
            </pre>
            <p className="text-sm text-muted-foreground">Du bör se loggar som:</p>
            <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto text-primary">
              <code>{`🔍 Starting Chromecast discovery...
📺 Found 2 Chromecast device(s)
✅ Selected device: Chromecast Ultra`}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Steg 4: Konfigurera via webbgränssnittet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Öppna webbappen (denna sida)</li>
              <li>Välj rätt Chromecast i dropdown-menyn</li>
              <li>Aktivera screensaver och ange URL</li>
              <li>Klicka "Spara"</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Steg 5: Kör som Windows-tjänst (valfritt)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">För att bridge ska starta automatiskt vid omstart, använd NSSM:</p>
            <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
              <code>{`nssm install ChromecastBridge "C:\\Program Files\\nodejs\\node.exe" "C:\\path\\to\\bridge\\index.js"
nssm set ChromecastBridge AppDirectory "C:\\path\\to\\bridge"
nssm start ChromecastBridge`}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Felsökning</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-3">
              <div className="flex gap-4">
                <span className="font-medium min-w-32">Hittar ingen Chromecast</span>
                <span className="text-muted-foreground">Kontrollera att enheten är på samma nätverk</span>
              </div>
              <div className="flex gap-4">
                <span className="font-medium min-w-32">Bridge startar inte</span>
                <span className="text-muted-foreground">Verifiera att .env har korrekta uppgifter</span>
              </div>
              <div className="flex gap-4">
                <span className="font-medium min-w-32">Screensaver startar inte</span>
                <span className="text-muted-foreground">Kontrollera Activity Log i webbappen</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Setup;
