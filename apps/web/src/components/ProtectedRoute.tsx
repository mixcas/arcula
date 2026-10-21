import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { returnStateFor } from "@/utils/returnPath";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    // Carry the asked-for page into the login screen so signing in returns
    // the visitor there instead of dropping them at /manage. It travels in
    // router state rather than a query param precisely because state is not
    // user-addressable — there is no open redirect to sanitise.
    return (
      <Navigate to="/login" replace state={returnStateFor(location.pathname)} />
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
