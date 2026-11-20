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

## Como acrescentar uma música
1. Cifra: rodar `python3 tools/parse_cifra.py CIFRA.pdf cifras/ID.json` (o PDF no modelo das cifras da Janaine: "Nível: ... / Tonalidade: ...", acordes acima da letra, barras com "I").
2. Partituras: exportar as páginas em PNG para `partituras/ID/`.
3. Áudio (só quando não houver YouTube): MP3 em `audio/ID.mp3`.
4. Acrescentar a música em `data/musicas.json` com `youtube` (link) ou `audio` (caminho).
5. Ao publicar mudanças no `sw.js`, trocar o número em `CACHE`.

## Publicar
1. Regras: copiar `firestore.rules` no console do Firebase (Firestore > Regras > Publicar).
2. Hospedagem: GitHub Pages deste repositório (branch main, pasta raiz). O arquivo `CNAME` aponta para maemusica.janainepavani.com.
3. DNS: registro CNAME `maemusica` apontando para `janainepavani.github.io`.
4. Firebase Authentication > Configurações > Domínios autorizados: maemusica.janainepavani.com e janainepavani.github.io.
