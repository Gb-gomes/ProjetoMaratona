/**
 * Painel padrão da interface: moldura, cabeçalho e corpo.
 *
 * Todos os painéis da tela usam as mesmas medidas (borda, raio, sombra,
 * altura do cabeçalho e respiro interno). Componha em vez de configurar:
 *
 *   <Panel labelledBy="upload-title">
 *     <PanelHeader id="upload-title" icon={FileSpreadsheet} title="Importação de pontos" />
 *     <PanelBody>…</PanelBody>
 *   </Panel>
 */
export function Panel({
  as: Tag = 'section', labelledBy, className = '', children, ...rest
}) {
  return (
    <Tag
      className={`rounded-md border border-slate-200 bg-white shadow-panel ${className}`}
      aria-labelledby={labelledBy}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Cabeçalho do painel. `title` vira um h2 com o `id` informado (use o mesmo
 * id no `labelledBy` do Panel). `actions` fica à direita; `description` vai
 * numa segunda linha, em tom secundário.
 */
export function PanelHeader({
  id, icon: Icon, iconClassName = 'text-petrol-500', title, description, actions, className = '',
}) {
  return (
    <div className={`border-b border-slate-100 px-3.5 py-2.5 ${className}`}>
      <div className="flex min-h-6 items-center gap-2">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-[14px] font-semibold leading-tight text-petrol-900 max-lg:text-[16px]">
          {Icon && <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden="true" />}
          {title}
        </h2>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && <div className="mt-0.5 text-[12px] text-slate-500 max-lg:text-[13px]">{description}</div>}
    </div>
  );
}

/** Corpo do painel com o respiro padrão. */
export function PanelBody({ className = '', children }) {
  return <div className={`px-3.5 py-3 ${className}`}>{children}</div>;
}
