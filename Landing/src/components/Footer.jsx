import { Globe, Briefcase, Code, Mail, ArrowUpRight } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="bg-white pt-16 pb-12 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col items-center text-center mb-12">
          
          {/* Brand */}
          <div className="flex items-center gap-2 mb-6">
            <div className="w-9 h-9 bg-dark rounded-xl flex items-center justify-center">
              <div className="w-4.5 h-4.5 bg-primary rounded-md rotate-45" />
            </div>
            <span className="text-xl font-bold tracking-tight text-dark">Routiqo</span>
          </div>
          
          <p className="text-text-secondary text-base max-w-sm mb-8">
            The next-generation logistics operating system for fast-growing delivery teams.
          </p>
          
          <div className="flex items-center gap-4">
            {[Globe, Briefcase, Code, Mail].map((Icon, i) => (
              <a key={i} href="#" className="w-10 h-10 rounded-full border border-gray-100 flex items-center justify-center text-dark hover:bg-dark hover:text-white hover:border-dark transition-all">
                <Icon size={18} />
              </a>
            ))}
          </div>
        </div>

        <div className="pt-12 border-t border-gray-100 flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-text-secondary text-sm">
            © 2026 Routiqo Inc. All rights reserved. Built with ❤️ by Akshat.
          </p>
          <div className="flex items-center gap-8">
            <a href="#" className="text-text-secondary text-sm hover:text-dark">Status</a>
            <a href="#" className="text-text-secondary text-sm hover:text-dark">Support</a>
            <a href="#" className="text-text-secondary text-sm hover:text-dark">API Docs</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
