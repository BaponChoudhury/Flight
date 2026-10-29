import { AdminEditor } from "@/components/AdminEditor";

// Hidden page: not linked anywhere, not indexed, and shows nothing until the admin password checks out.
export const metadata = { title: "Admin · Flight Finder", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <AdminEditor />
    </div>
  );
}
