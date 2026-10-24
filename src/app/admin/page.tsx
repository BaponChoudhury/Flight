import { AdminEditor } from "@/components/AdminEditor";

export const metadata = { title: "Admin · Flight Finder" };

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <AdminEditor />
    </div>
  );
}
