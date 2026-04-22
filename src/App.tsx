import { Toaster } from "@/components/ui/toaster";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/i18n/LanguageContext";
import Index from "./pages/Index";
import Setup from "./pages/Setup";
import NotFound from "./pages/NotFound";
import ChromecastReceiver from "./pages/ChromecastReceiver";

const App = () => (
  <LanguageProvider>
    <Toaster />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/chromecast-receiver.html" element={<ChromecastReceiver />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </LanguageProvider>
);

export default App;
