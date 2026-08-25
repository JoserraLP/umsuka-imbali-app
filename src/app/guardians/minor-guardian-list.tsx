import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface MinorWithGuardian {
  profile: {
    id: string;
    firstName: string;
    lastName: string;
    isMinor: boolean;
    legalGuardianId: string | null;
  };
  guardian: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    isMember: boolean;
    memberUserId: string | null;
  } | null;
}

export function MinorGuardianList({ items }: { items: MinorWithGuardian[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay menores registrados.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map(({ profile, guardian }) => (
        <div key={profile.id} className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Link href={`/members/${profile.id}`} className="font-medium hover:underline">
              {profile.firstName} {profile.lastName}
            </Link>
            <p className="text-xs text-muted-foreground">ID: {profile.id.slice(0, 8)}…</p>
          </div>
          <div className="text-right">
            {guardian ? (
              <>
                <p className="text-sm font-medium">{guardian.fullName}</p>
                <div className="flex justify-end gap-1">
                  <Badge variant={guardian.isMember ? "default" : "outline"}>
                    {guardian.isMember ? "Miembro" : "Externo"}
                  </Badge>
                </div>
                {guardian.email && <p className="text-xs text-muted-foreground">{guardian.email}</p>}
                {guardian.phone && <p className="text-xs text-muted-foreground">{guardian.phone}</p>}
              </>
            ) : (
              <Badge variant="destructive">Sin representante</Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
