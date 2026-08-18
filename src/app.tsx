import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import RuleParserPage from "@/pages/RuleParser/RuleParserPage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RuleParserPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
