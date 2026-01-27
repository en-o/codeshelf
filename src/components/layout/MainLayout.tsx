import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";

interface MainLayoutProps {
  children: (currentPage: string) => ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [currentPage, setCurrentPage] = useState("shelf");

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      <main className="flex-1 overflow-auto">{children(currentPage)}</main>
    </div>
  );
}
