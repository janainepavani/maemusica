# Repertório das Mães que Oram

Aplicativo web instalável (PWA) para as mães músicas do movimento Mães que Oram pelos Filhos: cifras com troca de tom, partituras, áudio de referência e caminhos para os cursos da Janaine Pavani.

Endereço: https://maemusica.janainepavani.com

## Como funciona
- **Cadastro e login:** e-mail e senha (Firebase Authentication, projeto `mae-musica`).
- **Quem entra:** `config/acesso.modo` = `alunas` (só quem está na lista) ou `aberto` (todas as mães). A Janaine troca no painel.
- **Lista de alunas:** `alunas/{email}`, importada no painel a partir da planilha do Eduzz ou da Nutror (o app pega todos os e-mails do arquivo) ou liberada uma a uma.
- **Dados de cada mãe:** Firestore, coleção `users/{uid}`: nome, email, whats, cidade, uf, grupo, instr, aluna (`sim` | `nao`, vem da lista), status (`ativa` | `pendente`), criadoEm, ultimoAcesso, acessos.
- **Painel da Janaine:** Perfil > Painel de cadastros, só para `janaine@janainepavani.com` com e-mail confirmado. Mostra totais, estados, busca e baixa a planilha (CSV).
- **Chamadas para os cursos:** quem não é aluna vê o curso em destaque; quem é aluna vê "Continue suas aulas", que leva à Nutror. Links em `data/config.json`.
- **Sem internet:** o aplicativo, as cifras e as partituras já abertas e os áudios já ouvidos ficam guardados no aparelho (`sw.js`).

## Como acrescentar músicas
Pelo painel (Perfil > Painel de cadastros > Músicas): escolher vários arquivos ou uma pasta. O app agrupa por música e reconhece o tipo pelo nome:
- "cifra" no nome: cifra em PDF no modelo da Janaine, convertida no navegador (`cifra.js`, mesmo algoritmo de `tools/parse_cifra.py`) e salva em `songs/{id}.cifraJson`;
- "grade" ou "full score": grade completa; "partes" ou "banda": partes da banda; outros PDFs: partitura. Cada página vira PNG no Storage (`songs/{id}/...`);
- MP3, M4A, WAV: áudio, para as músicas sem YouTube.
Antes de enviar, a Janaine confere nome, autor, link do YouTube e o tipo de cada arquivo. As músicas do painel ficam no Firestore (`songs`) e valem mais que as de `data/musicas.json`.

## Publicar
1. Regras: copiar `firestore.rules` (Firestore > Regras) e `storage.rules` (Storage > Regras) no console do Firebase. Projeto no plano Blaze, com alerta de orçamento.
2. Hospedagem: GitHub Pages deste repositório (branch main, pasta raiz). O arquivo `CNAME` aponta para maemusica.janainepavani.com.
3. DNS: registro CNAME `maemusica` apontando para `janainepavani.github.io`.
4. Firebase Authentication > Configurações > Domínios autorizados: maemusica.janainepavani.com e janainepavani.github.io.
