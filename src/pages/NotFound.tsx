import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.log("404: Användaren försökte nå en sida som inte finns:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Sidan kunde inte hittas</p>
        <Link to="/" className="text-primary underline hover:text-primary/90">
          Gå till startsidan
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
