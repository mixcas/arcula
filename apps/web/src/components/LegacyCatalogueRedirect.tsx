/**
 * The pre-rename `/collection/…` addresses, kept alive until the contract
 * step (#248).
 *
 * A bookmark, a mailed manage link or an in-app deep link that outlived the
 * rename must land on the catalogue address, not on the catch-all. Only the
 * word moves: the rest of the path (a work, the PDF, a settings tab, the
 * Deleted view), the query — `q` is the artwork search suffix — and the hash
 * all travel, so an old link keeps its page and its search. The navigation
 * replaces the history entry, so Back never bounces between the two spellings.
 */

import React from "react";
import { Navigate, useLocation } from "react-router-dom";

interface LegacyCatalogueRedirectProps {
  /** The old address prefix this route serves, without a trailing slash. */
  from: string;
  /** The catalogue address prefix that replaces it. */
  to: string;
}

const LegacyCatalogueRedirect: React.FC<LegacyCatalogueRedirectProps> = ({
  from,
  to,
}) => {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.startsWith(from) ? pathname.slice(from.length) : "";
  return <Navigate to={`${to}${rest}${search}${hash}`} replace />;
};

export default LegacyCatalogueRedirect;
