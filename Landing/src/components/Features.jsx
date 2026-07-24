import React from 'react';
import { motion } from 'framer-motion';
import { Route, Map, BarChart3, ShieldCheck, ArrowUpRight } from 'lucide-react';

const Features = () => {
  const features = [
    {
      title: "Route Optimization",
      desc: "Advanced algorithms to reduce mileage, fuel costs, and delivery time by up to 35%.",
      icon: <Route className="w-8 h-8" />,
      dark: false,
    },
    {
      title: "Real-Time Tracking",
      desc: "Monitor every vehicle, driver, and shipment in real-time with precise GPS tracking.",
      icon: <Map className="w-8 h-8" />,
      dark: false,
    },
    {
      title: "Fleet Management",
      desc: "Manage vehicle maintenance, fuel usage, and driver performance in one dashboard.",
      icon: <ShieldCheck className="w-8 h-8" />,
      dark: false,
    },
    {
      title: "Smart Dispatching",
      desc: "Automated order assignment based on driver proximity, capacity, and current workload.",
      icon: <BarChart3 className="w-8 h-8" />,
      dark: false,
    }
  ];

  return (
    <section id="features" className="py-16 px-4 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-2xl md:text-3xl font-bold text-dark mb-3"
          >
            Powerful Features for Modern Logistics
          </motion.h2>
          <p className="text-text-secondary text-sm max-w-xl mx-auto">
            Everything you need to manage a high-performance delivery operation at scale.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
          {features.map((f, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: -5 }}
              className={`p-6 rounded-2xl border transition-all duration-300 group cursor-pointer ${
                f.dark 
                ? 'bg-dark text-white border-dark shadow-xl' 
                : 'bg-white text-dark border-gray-100 shadow-lg'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110 duration-300 ${
                f.dark ? 'bg-primary text-dark' : 'bg-dark text-white'
              }`}>
                <div className="scale-75">{f.icon}</div>
              </div>
              <h3 className="text-lg font-bold mb-2">{f.title}</h3>
              <p className={`text-sm mb-5 leading-relaxed ${f.dark ? 'text-gray-400' : 'text-text-secondary'}`}>
                {f.desc}
              </p>

            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
