'use client'

import dynamic from 'next/dynamic'

const Page = dynamic(() => import('./page'), { ssr: false })

export default function PageWrapper() {
  return <Page />
}