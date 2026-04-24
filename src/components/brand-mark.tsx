import Image from "next/image";
import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/home/guida" className="group inline-flex w-full items-center">
      <div className="w-full transition-transform duration-200 group-hover:-translate-y-0.5">
        <Image
          src="/logo-morelli.png"
          alt="Cooperativa Morelli"
          width={220}
          height={68}
          priority
          className="h-auto w-full"
        />
      </div>
    </Link>
  );
}
