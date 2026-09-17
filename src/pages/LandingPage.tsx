import FaqSection from '../components/landing/FaqSection'
import FechasSorteoSection from '../components/landing/FechasSorteoSection'
import GanadoresSection from '../components/landing/GanadoresSection'
import HeroSection from '../components/landing/HeroSection'
import PremiosSection from '../components/landing/PremiosSection'
import TransparenciaSection from '../components/landing/TransparenciaSection'

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <FechasSorteoSection />
      <PremiosSection />
      <TransparenciaSection />
      <GanadoresSection />
      <FaqSection />
    </>
  )
}
