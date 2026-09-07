"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function Navbar() {
  const { data: session } = useSession();

  return (
    <div className="flex justify-between p-4 border-b bg-white">
      <h1 className="font-bold">Before You Pay</h1>

      {session ? (
        <div className="flex items-center gap-3">
          <img
            src={session.user?.image || ""}
            className="w-8 h-8 rounded-full"
          />
          <span>{session.user?.name}</span>

          <button
            onClick={() => signOut()}
            className="bg-red-500 text-white px-3 py-1 rounded"
          >
            Logout
          </button>
        </div>
      ) : (
        <button
          onClick={() => signIn("google")}
          className="bg-black text-white px-3 py-1 rounded"
        >
          Login
        </button>
      )}
    </div>
  );
}
