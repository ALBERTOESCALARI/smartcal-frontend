// src/features/users/api.ts
import { api } from "@/lib/api";

export type Credential = "EMT" | "Paramedic";

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────
export type User = {
  id: string;               // internal UUID
  employee_id?: string;     // human-friendly employee identifier (not the UUID)
  email: string;
  name?: string | null;
  role?: string | null;     // "admin" | "member"
  credentials?: Credential | string | string[] | null;  // optional to accommodate legacy payloads
  credential?: string | null;
  is_locked?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type CreateUserPayload = {
  email: string;
  name?: string;
  role?: string;         // optional; defaults server-side to "member"
  employee_id: string;   // required; used for login/reset flows
  credentials: Credential;  // REQUIRED now
  password?: string;     // optional; if omitted, server returns temp_password
};

export type CreateUserResponse = User & {
  temp_password?: string | null;
};

// ────────────────────────────────────────────────────────────────────────────────
// Helper: surface422
// ────────────────────────────────────────────────────────────────────────────────
type ApiValidationItem = {
  loc?: Array<string | number>;
  msg?: string;
};

type ApiErrorResponse = {
  detail?: string | ApiValidationItem[] | Record<string, unknown>;
};

type ApiError = {
  response?: {
    status?: number;
    data?: ApiErrorResponse | string;
  };
  message?: string;
};

function surface422(err: unknown): never {
  const error = err as ApiError;
  const status = error?.response?.status;
  const rawData = error?.response?.data;
  const detailPayload: ApiErrorResponse["detail"] | string | undefined =
    typeof rawData === "string" ? rawData : rawData?.detail;

  if (status === 422 && detailPayload) {
    const message = Array.isArray(detailPayload)
      ? detailPayload
          .map((item) => {
            const path = item.loc?.join(".") ?? "field";
            return `${path}: ${item.msg ?? "invalid"}`;
          })
          .join("; ")
      : typeof detailPayload === "string"
      ? detailPayload
      : (() => {
          try {
            return JSON.stringify(detailPayload);
          } catch {
            return String(detailPayload);
          }
        })();
    throw new Error(`Validation failed (422): ${message}`);
  }
  throw err;
}

function normalizeCredential(v: unknown): Credential {
  const s = String(v || "").trim().toLowerCase();
  if (s === "emt") return "EMT";
  if (s === "paramedic") return "Paramedic";
  throw new Error('Invalid credentials: must be "EMT" or "Paramedic"');
}

// ────────────────────────────────────────────────────────────────────────────────
// CRUD operations
// ────────────────────────────────────────────────────────────────────────────────

/** List users for a tenant */
export async function fetchUsers(tenantId: string): Promise<User[]> {
  try {
    const { data } = await api.get<User[]>("/users", {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    });
    return data;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Create a user */
export async function createUser(
  tenantId: string,
  payload: CreateUserPayload
): Promise<CreateUserResponse> {
  const email = (payload?.email ?? "").trim();
  if (!email) throw new Error("Email is required");

  const employeeId = payload.employee_id.trim();
  if (!employeeId) throw new Error("Employee ID is required");

  const credentials = normalizeCredential(payload.credentials);

  try {
    const { data } = await api.post<CreateUserResponse>(
      "/users",
      { ...payload, credentials },
      { params: tenantId ? { tenant_id: tenantId } : undefined }
    );
    return data;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Update a user's attributes */
export async function updateUser(
  tenantId: string,
  userId: string,
  payload: { email?: string; name?: string; role?: string; credentials?: Credential }
): Promise<User> {
  try {
    const { data } = await api.put<User>(`/users/${userId}`, payload, {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    });
    return data;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Delete a user by id */
export async function deleteUser(tenantId: string, userId: string): Promise<string> {
  try {
    await api.delete(`/users/${userId}`, {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    });
    return userId;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Password management
// ────────────────────────────────────────────────────────────────────────────────

/** Change user password (admin or self) */
export async function changeUserPassword(
  tenantId: string,
  id: string,
  body: { current_password: string; new_password: string }
): Promise<boolean> {
  if (!body?.new_password || body.new_password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  try {
    await api.put(`/users/${id}/password`, body, { params: { tenant_id: tenantId } });
    return true;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Request password reset */
export async function requestPasswordReset(
  employeeId: string,
  email: string
): Promise<void> {
  try {
    await api.post("/auth/password/reset", { email, employee_id: employeeId });
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Complete password reset (invite or reset) */
export async function completePasswordReset(
  token: string,
  new_password: string
): Promise<void> {
  if (!new_password || new_password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  try {
    await api.post("/auth/password/complete", { token, new_password });
  } catch (err) {
    surface422(err);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Invites & Unlock
// ────────────────────────────────────────────────────────────────────────────────

/** Invite a user (admin only) */
export async function inviteUser(
  tenantId: string,
  payload: {
    email: string;
    name?: string;
    role?: string;
    employee_id?: string;
    credentials: Credential;
    expires_minutes?: number;
  }
): Promise<{ id: string; email: string }> {
  try {
    const { data } = await api.post("/users/invite", payload, {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    });
    return data;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Unlock a user account (admin only) */
export async function unlockUser(tenantId: string, id: string): Promise<void> {
  try {
    await api.post(`/users/${id}/unlock`, null, {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    });
  } catch (err) {
    surface422(err);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Bulk import (admin): supports optional invite emails
// ────────────────────────────────────────────────────────────────────────────────
type BulkUserInput = {
  email: string;
  name?: string;
  employee_id?: string;
  role?: string;
  credentials: Credential | string;
  [key: string]: unknown;
};

type BulkUsersPayload = { users: BulkUserInput[] } | BulkUserInput[];

type BulkUsersResultItem = {
  email: string;
  status: string;
  error?: string;
};

type BulkUsersResponse = {
  created: number;
  skipped: number;
  results?: BulkUsersResultItem[];
  invited?: number;
};

export async function postBulkUsers(
  tenantId: string,
  payload: BulkUsersPayload,
  sendInvites: boolean
): Promise<BulkUsersResponse> {
  if (!tenantId) throw new Error("Missing tenantId");

  const bodyUsers = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.users)
    ? payload.users
    : [];

  const users = bodyUsers.map((user, idx) => {
    if (!user?.email) throw new Error(`Row ${idx}: email is required`);
    const cred = normalizeCredential(user.credentials);
    return { ...user, credentials: cred };
  });

  const params: Record<string, string> = {
    tenant_id: tenantId,
    send_invites: sendInvites ? "true" : "false",
  };

  try {
    const { data } = await api.post(
      "/users/bulk",
      { users },
      { params }
    );
    return data as BulkUsersResponse;
  } catch (err) {
    surface422(err);
    throw err;
  }
}

/** Invite existing users (admin only) */
export async function inviteExistingUsers(
  tenantId: string,
  payload: { emails?: string[]; only_without_password?: boolean } = {}
): Promise<{ invited: number; total: number; results: {email:string; status:string; error?:string}[] }> {
  try {
    const { data } = await api.post("/users/invite-existing", payload, {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    });
    return data;
  } catch (err) {
    surface422(err);
    throw err;
  }
}
